import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerCustomerRoutes } from "./routes/customers";
import { registerContactRoutes } from "./routes/contacts";
import itemsRouter from "./routes/items";
import { registerValidatorHealthRoutes } from "./routes/validator-health";
import { registerContactEmbeddingRoutes } from "./routes/contact-embeddings";
import { registerCustomerEmbeddingRoutes } from "./routes/customer-embeddings";
import { registerItemEmbeddingRoutes } from "./routes/item-embeddings";
import { validatorHealthService } from "./services/validator-health";
import { gmailService } from "./services/gmail";
import { aiService, type AIEngine } from "./services/ai-service";
import { netsuiteService } from "./services/netsuite";
// openaiCustomerFinderService now uses per-email instances to prevent race conditions
import { OpenAISKUValidatorService } from "./services/openai-sku-validator";
import { OpenAIContactValidatorService } from "./services/openai-contact-validator";
import { db } from "./db";
import { purchaseOrders, errorLogs, customers } from "@shared/schema";
import { eq, desc, and, or, lt, sql } from "drizzle-orm";

import { insertPurchaseOrderSchema, insertErrorLogSchema, classificationResultSchema } from "@shared/schema";
import { z } from "zod";

// NOTE: Validator instances are now created per-email to prevent race conditions
// Previously used singleton validators caused state pollution between sequential emails

// 🔥 REAL-TIME PROCESSING STATUS TRACKING
let currentProcessingStatus = {
  isProcessing: false,
  currentStep: "",
  currentEmail: "",
  currentPO: "",
  emailNumber: 0,
  totalEmails: 0
};

// Helper function to update processing status for real-time monitoring
function updateProcessingStatus(update: Partial<typeof currentProcessingStatus>) {
  currentProcessingStatus = { ...currentProcessingStatus, ...update };
  console.log(`📊 PROCESSING STATUS: ${currentProcessingStatus.currentStep || 'Idle'} ${currentProcessingStatus.currentEmail ? `(${currentProcessingStatus.currentEmail})` : ''}`);
}

// Complete validation system workflow - processes emails with real-time status updates
async function processEmailWithValidationSystem() {
  console.log(`\n🔄 UNIFIED PROCESSING: Starting automatic email processing through validation system...`);
  
  try {
    // Step 1: Fetch unprocessed emails
    updateProcessingStatus({
      isProcessing: true,
      currentStep: "fetching_emails",
      currentEmail: "Checking for new emails...",
      emailNumber: 0,
      totalEmails: 0
    });

    const messages = await gmailService.getMessages('in:inbox -label:processed -label:filtered');
    console.log(`📧 Found ${messages.length} total inbox messages`);

    // Find first unprocessed message
    let messageToProcess = null;
    for (const message of messages) {
      const existingQueue = await storage.getEmailQueueByGmailId(message.id);
      if (!existingQueue) {
        messageToProcess = message;
        break;
      }
    }

    if (!messageToProcess) {
      updateProcessingStatus({
        isProcessing: false,
        currentStep: "no_emails",
        currentEmail: "No new emails to process",
        emailNumber: 0,
        totalEmails: 0
      });
      
      return {
        message: "No new emails found to process",
        processed: 0,
        details: null
      };
    }

    // Start processing this email
    updateProcessingStatus({
      isProcessing: true,
      currentStep: "email_preprocessing",
      currentEmail: `${messageToProcess.subject} (${messageToProcess.sender})`,
      emailNumber: 1,
      totalEmails: 1
    });

    console.log(`\n🔄 PROCESSING EMAIL: "${messageToProcess.subject}"`);
    console.log(`   └─ From: ${messageToProcess.sender}`);
    console.log(`   └─ Attachments: ${messageToProcess.attachments.length}`);

    const result = await processEmailThroughValidationSystem(messageToProcess, updateProcessingStatus);
    
    return {
      message: "Email processed successfully",
      processed: 1,
      details: {
        emailId: messageToProcess.id,
        sender: messageToProcess.sender,
        subject: messageToProcess.subject,
        result: result
      }
    };

  } catch (error) {
    console.error('Validation system processing failed:', error);
    updateProcessingStatus({
      isProcessing: false,
      currentStep: "error",
      currentEmail: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      emailNumber: 0,
      totalEmails: 0
    });
    throw error;
  }
}

// Helper function to process email through complete validation system
async function processEmailThroughValidationSystem(messageToProcess: any, updateProcessingStatus: Function) {
  updateProcessingStatus({
    isProcessing: true,
    currentStep: "forwarded_email_check",
    currentEmail: `Checking forwarded email: ${messageToProcess.subject}`,
    emailNumber: 1,
    totalEmails: 1
  });

  // Check for forwarded email from @highcaliberline.com and extract CNumber
  let isForwardedEmail = false;
  let extractedCNumber = null;
  let effectiveSender = messageToProcess.sender;
  let hclCustomerLookup = null;
  
  if (messageToProcess.sender.includes('@highcaliberline.com')) {
    console.log(`\n📨 FORWARDED EMAIL DETECTION: Checking for CNumber in @highcaliberline.com email...`);
    
    // Look for CNumber pattern in subject and body (more specific patterns to avoid zip codes)
    const cNumberPattern = /(?:Account\s+C|Customer\s+C|CNumber\s*:?\s*C?|C\s*#\s*:?\s*C?)(\d{4,6})\b/i;
    const subjectMatch = messageToProcess.subject.match(cNumberPattern);
    const bodyMatch = messageToProcess.body.match(cNumberPattern);
    
    // Additional validation: ensure it's a reasonable CNumber format (4-6 digits)
    let validCNumber = null;
    const foundMatch = subjectMatch?.[1] || bodyMatch?.[1];
    if (foundMatch && foundMatch.length >= 4 && foundMatch.length <= 6) {
      validCNumber = foundMatch;
    }
    
    if (validCNumber) {
      extractedCNumber = validCNumber;
      isForwardedEmail = true;
      console.log(`   ✅ Found CNumber: ${extractedCNumber}`);
      
      // Lookup customer using the advanced customer finder
      const { customerFinderService } = await import('./services/customer-finder');
      const fullCNumber = `C${extractedCNumber}`;
      hclCustomerLookup = await customerFinderService.findByCNumber(fullCNumber);
      
      if (hclCustomerLookup.customer_number) {
        console.log(`   ✅ HCL Customer found: ${hclCustomerLookup.customer_name} (${hclCustomerLookup.customer_number})`);
        console.log(`   └─ This is a forwarded email - will use customer from Gemini extraction, or fallback to HCL lookup`);
      } else {
        console.log(`   ⚠️  No HCL customer found for CNumber: ${fullCNumber}`);
      }
    } else {
      console.log(`   └─ No CNumber found in subject or body`);
    }
  }

  // Create email queue item
  const queueItem = await storage.createEmailQueueItem({
    gmailId: messageToProcess.id,
    sender: messageToProcess.sender,
    subject: messageToProcess.subject,
    body: messageToProcess.body,
    attachments: messageToProcess.attachments,
    labels: messageToProcess.labels,
    status: 'processing'
  });

  // Process email using two-step approach
  console.log(`🤖 AI PROCESSING: Starting two-step analysis...`);
  const processingResult = await aiService.processEmail({
    sender: messageToProcess.sender,
    subject: messageToProcess.subject,
    body: messageToProcess.body,
    attachments: messageToProcess.attachments
  });
  console.log(`   └─ Pre-processing: ${processingResult.preprocessing.response} (Continue: ${processingResult.preprocessing.shouldProceed})`);
  if (processingResult.classification) {
    console.log(`   └─ Detailed route: ${processingResult.classification.recommended_route} (${Math.round((processingResult.classification.analysis_flags.confidence_score || 0) * 100)}%)`);
  }

  // Update queue item with results for ALL emails (processed AND filtered)
  const updateData: any = {
    preprocessingResult: processingResult.preprocessing,
    status: processingResult.preprocessing.shouldProceed ? 'processed' : 'filtered',
    processedAt: new Date()
  };

  if (processingResult.classification) {
    updateData.classificationResult = processingResult.classification;
    updateData.route = processingResult.classification.recommended_route;
    updateData.confidence = processingResult.classification.analysis_flags?.confidence_score || 0;
  } else {
    // For filtered emails (Follow Up, None of these), capture preprocessing reason
    updateData.route = 'FILTERED';
    updateData.classificationResult = {
      analysis_flags: {
        filtered_reason: processingResult.preprocessing.response,
        confidence_score: processingResult.preprocessing.score || 0
      }
    };
  }

  await storage.updateEmailQueueItem(queueItem.id, updateData);

  let purchaseOrder = null;
  let extractionResult = null;
  let attachmentPaths: Array<{filename: string; storagePath: string; buffer?: Buffer}> = [];

  // Store PDF attachments if any
  if (messageToProcess.attachments.length > 0) {
    attachmentPaths = await gmailService.storeEmailAttachments(
      messageToProcess.id,
      messageToProcess.attachments
    );
  }

  // Save original email as .eml file for classified emails
  if (processingResult.preprocessing.shouldProceed && processingResult.classification) {
    try {
      console.log(`\n📧 EMAIL PRESERVATION: Saving classified email as .eml file...`);
      const rawEmailContent = await gmailService.getRawEmailContent(messageToProcess.id);
      
      const { ObjectStorageService } = await import('./objectStorage');
      const objectStorageService = new ObjectStorageService();
      
      const emlPath = await objectStorageService.storeEmailFile(
        messageToProcess.id,
        messageToProcess.subject,
        rawEmailContent
      );
      
      console.log(`   ✅ Email preserved at: ${emlPath}`);
    } catch (error) {
      console.error(`   ❌ Failed to preserve email:`, error);
    }
  }

  // Create purchase order if email passed both steps
  if (processingResult.preprocessing.shouldProceed && processingResult.classification && 
      processingResult.classification.recommended_route !== 'REVIEW') {
    
    // Process PDF attachments with Gemini FIRST if this is an attachment route
    console.log(`\n📁 ATTACHMENT PROCESSING:`);
    console.log(`   └─ Route: ${processingResult.classification.recommended_route}`);
    console.log(`   └─ Has attachments: ${attachmentPaths.length > 0}`);
    
    if ((processingResult.classification.recommended_route === 'ATTACHMENT_PO' || 
         processingResult.classification.recommended_route === 'ATTACHMENT_SAMPLE') &&
        attachmentPaths.length > 0) {
      
      // Find PDF attachments and process them
      const pdfAttachments = attachmentPaths.filter(att => att.buffer);
      console.log(`   └─ Found ${pdfAttachments.length} PDF attachments with buffers`);
      
      if (pdfAttachments.length > 0) {
        console.log(`\n🔍 AI DOCUMENT FILTERING: Pre-screening attachments before Gemini processing...`);
        
        // CRITICAL FIX: Prioritize actual purchase order files over proof/artwork files
        console.log(`\n📋 ATTACHMENT PRIORITIZATION: Sorting attachments to prioritize purchase orders...`);
        const prioritizedAttachments = pdfAttachments.sort((a, b) => {
          const aFilename = a.filename.toLowerCase();
          const bFilename = b.filename.toLowerCase();
          
          // Purchase order indicators (high priority)
          const aPOScore = (aFilename.includes('purchaseorder') ? 100 : 0) + 
                         (aFilename.includes('purchase_order') ? 100 : 0) + 
                         (aFilename.includes('purchase order') ? 100 : 0) +
                         (aFilename.includes('po_') ? 50 : 0) +
                         (aFilename.match(/po[\s\-_#]*\d+/) ? 75 : 0);
                         
          const bPOScore = (bFilename.includes('purchaseorder') ? 100 : 0) + 
                         (bFilename.includes('purchase_order') ? 100 : 0) + 
                         (bFilename.includes('purchase order') ? 100 : 0) +
                         (bFilename.includes('po_') ? 50 : 0) +
                         (bFilename.match(/po[\s\-_#]*\d+/) ? 75 : 0);
          
          // Proof/artwork indicators (negative priority)
          const aProofScore = (aFilename.includes('proof') ? -100 : 0) + 
                            (aFilename.includes('artwork') ? -100 : 0) + 
                            (aFilename.includes('mock') ? -50 : 0) +
                            (aFilename.includes('layout') ? -50 : 0);
                            
          const bProofScore = (bFilename.includes('proof') ? -100 : 0) + 
                            (bFilename.includes('artwork') ? -100 : 0) + 
                            (bFilename.includes('mock') ? -50 : 0) +
                            (bFilename.includes('layout') ? -50 : 0);
          
          const aTotal = aPOScore + aProofScore;
          const bTotal = bPOScore + bProofScore;
          
          return bTotal - aTotal; // Higher scores first
        });
        
        console.log(`   └─ Attachment processing order:`);
        prioritizedAttachments.forEach((att, i) => {
          const filename = att.filename.toLowerCase();
          const isPO = filename.includes('purchaseorder') || filename.includes('purchase_order') || filename.includes('purchase order');
          const isProof = filename.includes('proof') || filename.includes('artwork');
          console.log(`      ${i+1}. ${att.filename} ${isPO ? '✅ (PO Priority)' : isProof ? '❌ (Proof - Low Priority)' : '(Standard)'}`);
        });
        
        let processedPO = false;
        
        // Filter and process each PDF attachment in priority order
        for (let i = 0; i < prioritizedAttachments.length && !processedPO; i++) {
          const pdfAttachment = prioritizedAttachments[i];
          console.log(`   └─ Screening: ${pdfAttachment.filename} (${pdfAttachment.buffer?.length} bytes)`);
          
          try {
            // Step 1: AI Document Filter - determine if this is actually a purchase order
            const filterResult = await aiService.filterDocumentType(pdfAttachment.buffer!, pdfAttachment.filename);
            
            if (filterResult.document_type === "purchase order") {
              console.log(`      ✅ PASSED: Document identified as purchase order`);
              
              // Step 2: Process with Gemini extraction (only for documents that passed filter)
              try {
                // 🔥 UPDATE STATUS: Gemini Extraction
                updateProcessingStatus({
                  currentStep: "gemini_extraction"
                });

                console.log(`\n🧠 GEMINI EXTRACTION: Processing validated PO document...`);
                console.log(`   └─ File: ${pdfAttachment.filename}`);
                
                extractionResult = await aiService.extractPODataFromPDF(pdfAttachment.buffer!, pdfAttachment.filename);
                
                console.log(`   ✅ SUCCESS: Extracted PO data from PDF`);
                console.log(`   └─ Client PO Number: ${extractionResult?.purchaseOrder?.purchaseOrderNumber || 'NOT FOUND'}`);
                if (extractionResult?.purchaseOrder?.customer?.company) {
                  console.log(`   └─ Customer: ${extractionResult.purchaseOrder.customer.company}`);
                }
                if (extractionResult?.lineItems?.length) {
                  console.log(`   └─ Line Items: ${extractionResult.lineItems.length}`);
                }
                
                processedPO = true; // Stop processing additional attachments once we find a valid PO
                
              } catch (error) {
                console.error(`   ❌ GEMINI EXTRACTION FAILED for ${pdfAttachment.filename}:`, error);
                // Continue to next attachment if this one failed extraction
              }
              
            } else {
              console.log(`      ❌ FILTERED OUT: Document classified as '${filterResult.document_type}'`);
              console.log(`      └─ Skipping Gemini extraction (not a purchase order)`);
            }
            
          } catch (error) {
            console.error(`   ❌ DOCUMENT FILTER FAILED for ${pdfAttachment.filename}:`, error);
            console.log(`      └─ Skipping this document due to filter error`);
          }
        }
        
        if (!processedPO && pdfAttachments.length > 0) {
          console.log(`\n⚠️  NO PURCHASE ORDERS FOUND: All ${pdfAttachments.length} attachments were filtered out`);
          console.log(`   └─ Attachments appear to be artwork, proofs, invoices, or other non-PO documents`);
        }
      }
    } else if (processingResult.classification.recommended_route === 'TEXT_PO') {
      // Process TEXT_PO route with Gemini email text extraction
      try {
        console.log(`\n🧠 GEMINI: Processing email text for TEXT_PO extraction...`);
        console.log(`   └─ Subject: ${messageToProcess.subject}`);
        console.log(`   └─ Body length: ${messageToProcess.body.length} characters`);
        console.log(`   └─ From: ${messageToProcess.sender}`);
        
        extractionResult = await aiService.extractPODataFromText(
          messageToProcess.subject,
          messageToProcess.body,
          messageToProcess.sender
        );
        console.log(`   ✅ SUCCESS: Extracted PO data from email text`);
        console.log(`   └─ Client PO Number: ${extractionResult?.purchaseOrder?.purchaseOrderNumber || 'NOT FOUND'}`);
        if (extractionResult?.purchaseOrder?.customer?.company) {
          console.log(`   └─ Customer: ${extractionResult.purchaseOrder.customer.company}`);
        }
        if (extractionResult?.lineItems?.length) {
          console.log(`   └─ Line Items: ${extractionResult.lineItems.length}`);
        }
      } catch (error) {
        console.error(`   ❌ FAILED: Email text extraction error:`, error);
        // Continue without extraction result
      }
    } else if (processingResult.classification.recommended_route === 'TEXT_SAMPLE') {
      // Process TEXT_SAMPLE route with Gemini email text extraction (same as TEXT_PO)
      try {
        console.log(`\n🧠 GEMINI: Processing email text for TEXT_SAMPLE extraction...`);
        console.log(`   └─ Subject: ${messageToProcess.subject}`);
        console.log(`   └─ Body length: ${messageToProcess.body.length} characters`);
        console.log(`   └─ From: ${messageToProcess.sender}`);
        
        extractionResult = await aiService.extractPODataFromText(
          messageToProcess.subject,
          messageToProcess.body,
          messageToProcess.sender
        );
        console.log(`   ✅ SUCCESS: Extracted sample request data from email text`);
        console.log(`   └─ Client PO Number: ${extractionResult?.purchaseOrder?.purchaseOrderNumber || 'NOT FOUND'}`);
        if (extractionResult?.purchaseOrder?.customer?.company) {
          console.log(`   └─ Customer: ${extractionResult.purchaseOrder.customer.company}`);
        }
        if (extractionResult?.lineItems?.length) {
          console.log(`   └─ Line Items: ${extractionResult.lineItems.length}`);
        }
      } catch (error) {
        console.error(`   ❌ FAILED: Sample request text extraction error:`, error);
        // Continue without extraction result
      }
    } else {
      console.log(`   └─ Skipping Gemini processing (route: ${processingResult.classification.recommended_route})`);
    }
    
    // 🔥 UPDATE STATUS: PO Assignment
    updateProcessingStatus({
      currentStep: "po_assignment",
      currentPO: extractionResult?.purchaseOrder?.purchaseOrderNumber || "Generating..."
    });

    // Use extracted PO number if available, otherwise generate synthetic one
    console.log(`\n🆔 PO NUMBER ASSIGNMENT:`);
    let poNumber;
    
    // Try multiple extraction paths for PO number
    const extractedPONumber = extractionResult?.purchaseOrder?.purchaseOrderNumber || 
                              extractionResult?.purchaseOrderNumber ||
                              extractionResult?.clientPONumber;
    
    if (extractedPONumber && extractedPONumber.trim()) {
      // Clean up the PO number (remove extra spaces, prefixes like "PO:", etc.)
      let cleanPONumber = extractedPONumber.trim().replace(/^(PO:?|Purchase Order:?)\s*/i, '');
      
      // Check if this PO number already exists and append suffix if needed
      poNumber = cleanPONumber;
      let originalPoNumber = poNumber;
      let suffix = 1;
      
      while (await storage.getPurchaseOrderByNumber(poNumber)) {
        poNumber = `${originalPoNumber}-${suffix}`;
        suffix++;
      }
      
      if (suffix > 1) {
        console.log(`   ⚠️  PO number ${originalPoNumber} already exists, using: ${poNumber}`);
      } else {
        console.log(`   ✅ Using extracted PO number: ${poNumber}`);
      }
    } else {
      poNumber = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      console.log(`   ⚠️  No PO number found in extraction, generated synthetic: ${poNumber}`);
      console.log(`   └─ Extraction structure check: purchaseOrder=${!!extractionResult?.purchaseOrder}, purchaseOrderNumber=${extractionResult?.purchaseOrder?.purchaseOrderNumber}`);
    }
    
    // Determine effective sender and customer for forwarded emails
    let effectiveSenderForPO = messageToProcess.sender;
    let customerInfo = null;
    let customerMeta = null;
    let contactMeta = null;
    
    // Extract and validate contact information (always run - required field for NetSuite)
    console.log(`\n👤 CONTACT EXTRACTION:`);
    
    // Check if contact was extracted from purchase order
    const extractedContact = extractionResult?.purchaseOrder?.contact;
    if (extractedContact) {
      console.log(`   └─ Contact Name: ${extractedContact.name || 'Not provided'}`);
      console.log(`   └─ Contact Email: ${extractedContact.email || 'Not provided'}`);
      console.log(`   └─ Contact Phone: ${extractedContact.phone || 'Not provided'}`);
      console.log(`   └─ Job Title: ${extractedContact.jobTitle || 'Not provided'}`);
    } else {
      console.log(`   ⚠️  No contact information extracted from purchase order - will validate sender email`);
    }

    // 🔥 UPDATE STATUS: Contact Validation (always run)
    updateProcessingStatus({
      currentStep: "contact_validation"
    });

    // ALWAYS run contact validation against HCL contacts database
    try {
      // Create fresh validator instance for this email to prevent race conditions with health monitoring
      const contactValidator = await validatorHealthService.recordValidatorCall(
        'contactValidator',
        async () => new OpenAIContactValidatorService()
      );
      
      // Use extracted contact if available, otherwise fall back to sender email
      const validatedContact = await contactValidator.validateContact({
        extractedData: extractionResult,
        senderName: extractedContact?.name,
        senderEmail: messageToProcess.sender,
        contactName: extractedContact?.name,
        contactEmail: extractedContact?.email || messageToProcess.sender,
        contactPhone: extractedContact?.phone,
        jobTitle: extractedContact?.jobTitle,
        resolvedCustomerId: customerMeta?.customer_number,
        companyId: customerMeta?.customer_number
      });
      
      contactMeta = validatedContact;
      console.log(`   ✅ Contact validated: ${validatedContact.name} <${validatedContact.email}>`);
      console.log(`   └─ Method: ${validatedContact.match_method} (Confidence: ${validatedContact.confidence})`);
      console.log(`   └─ Role: ${validatedContact.role}`);
      console.log(`   └─ Evidence: ${validatedContact.evidence?.join(', ') || 'None provided'}`);
      
      // STEP 2 COMPLETION: Update database immediately with contact validation results
      try {
        const tempPO = await storage.getPurchaseOrderByNumber(poNumber);
        if (tempPO) {
          await storage.updatePurchaseOrder(tempPO.id, {
            contactMeta: contactMeta,
            contact: validatedContact.name || validatedContact.email,
            contactValidated: true
          });
          console.log(`   ✅ STEP 2 COMPLETED: Contact data stored in database`);
        }
      } catch (stepError) {
        console.error(`   ❌ STEP 2 FAILED: Could not store contact data:`, stepError);
      }
    } catch (error) {
      console.error(`   ❌ Contact validation failed:`, error);
      
      // Create basic contact metadata using sender email as fallback
      contactMeta = {
        name: extractedContact?.name || '',
        role: 'Unknown',
        email: extractedContact?.email || messageToProcess.sender,
        phone: extractedContact?.phone || '',
        evidence: ['Contact validation failed - using sender email'],
        confidence: 0.5,
        match_method: 'FALLBACK_SENDER',
        matched_contact_id: ''
      };
      
      console.log(`   ⚠️  Using fallback contact: ${messageToProcess.sender}`);
    }

    // 🔥 UPDATE STATUS: Customer Validation
    updateProcessingStatus({
      currentStep: "customer_validation"
    });

    // Lookup customer in HCL database for all purchase orders using OpenAI-powered matching
    if (extractionResult?.purchaseOrder?.customer) {
      console.log(`\n🔍 OPENAI CUSTOMER LOOKUP:`);
      console.log(`   └─ Searching HCL database for: ${extractionResult.purchaseOrder.customer.company || 'Unknown'}`);
      
      try {
        // Create fresh customer finder instance for this email to prevent race conditions with health monitoring
        const { OpenAICustomerFinderService } = await import('./services/openai-customer-finder');
        const customerFinder = await validatorHealthService.recordValidatorCall(
          'customerFinder',
          async () => new OpenAICustomerFinderService()
        );
        const customerMatch = await customerFinder.findCustomer({
          customerName: extractionResult.purchaseOrder.customer.company,
          customerEmail: extractionResult.purchaseOrder.customer.email,
          senderEmail: messageToProcess.sender,
          asiNumber: extractionResult.purchaseOrder.asiNumber,
          ppaiNumber: extractionResult.purchaseOrder.ppaiNumber,
          address: extractionResult.purchaseOrder.customer.address1
        });
        
        // Improved reliability with status-based handling
        if (customerMatch.status === 'found' && customerMatch.customer_number) {
          customerMeta = customerMatch;
          console.log(`   ✅ OpenAI found HCL customer: ${customerMatch.customer_name} (${customerMatch.customer_number})`);
          console.log(`   └─ Method: ${customerMatch.method} (Confidence: ${Math.round((customerMatch.confidence || 0) * 100)}%)`);
          
          // STEP 1 COMPLETION: Update database immediately with customer validation results
          try {
            const tempPO = await storage.getPurchaseOrderByNumber(poNumber);
            if (tempPO) {
              await storage.updatePurchaseOrder(tempPO.id, {
                customerMeta: customerMeta,
                status: 'customer_found'
              });
              console.log(`   ✅ STEP 1 COMPLETED: Customer data stored in database`);
            }
          } catch (stepError) {
            console.error(`   ❌ STEP 1 FAILED: Could not store customer data:`, stepError);
          }
        } else {
          console.log(`   ⚠️  OpenAI could not find HCL customer match`);
          console.log(`   └─ Status: ${customerMatch.status}, Method: ${customerMatch.method}, Confidence: ${Math.round((customerMatch.confidence || 0) * 100)}%`);
          
          // Try backup lookup with simplified inputs if main attempt failed
          try {
            console.log(`\n🔍 FALLBACK CUSTOMER LOOKUP: Trying simplified search...`);
            const fallbackMatch = await customerFinder.findCustomer({
              customerName: extractionResult.purchaseOrder.customer.company,
              customerEmail: extractionResult.purchaseOrder.customer.email || messageToProcess.sender,
              senderEmail: messageToProcess.sender
            });
            
            if (fallbackMatch.status === 'found' && fallbackMatch.customer_number) {
              customerMeta = fallbackMatch;
              console.log(`   ✅ Fallback found HCL customer: ${fallbackMatch.customer_name} (${fallbackMatch.customer_number})`);
              console.log(`   └─ Method: ${fallbackMatch.method} (Confidence: ${Math.round((fallbackMatch.confidence || 0) * 100)}%)`);
            } else {
              console.log(`   ❌ Fallback customer lookup also failed`);
            }
          } catch (fallbackError) {
            console.error(`   ❌ Fallback customer lookup also failed:`, fallbackError);
          }
        }
      } catch (error) {
        console.error(`   ❌ Customer lookup failed:`, error);
        // Try backup lookup with simplified inputs if main attempt failed
        try {
          console.log(`\n🔍 FALLBACK CUSTOMER LOOKUP: Trying simplified search...`);
          const { OpenAICustomerFinderService } = await import('./services/openai-customer-finder');
          const customerFinder = await validatorHealthService.recordValidatorCall(
            'customerFinder',
            async () => new OpenAICustomerFinderService()
          );
          const fallbackMatch = await customerFinder.findCustomer({
            customerName: extractionResult.purchaseOrder.customer.company,
            customerEmail: extractionResult.purchaseOrder.customer.email || messageToProcess.sender,
            senderEmail: messageToProcess.sender
          });
          
          if (fallbackMatch.status === 'found' && fallbackMatch.customer_number) {
            customerMeta = fallbackMatch;
            console.log(`   ✅ Fallback found HCL customer: ${fallbackMatch.customer_name} (${fallbackMatch.customer_number})`);
            console.log(`   └─ Method: ${fallbackMatch.method} (Confidence: ${Math.round((fallbackMatch.confidence || 0) * 100)}%)`);
          } else {
            console.log(`   ❌ Fallback customer lookup also failed`);
          }
        } catch (fallbackError) {
          console.error(`   ❌ Fallback customer lookup also failed:`, fallbackError);
        }
      }
    }
    
    if (isForwardedEmail && extractionResult?.purchaseOrder?.customer) {
      console.log(`\n📋 FORWARDED EMAIL PROCESSING:`);
      console.log(`   └─ Original sender: ${messageToProcess.sender}`);
      console.log(`   └─ CNumber: ${extractedCNumber}`);
      console.log(`   └─ Using customer from Gemini: ${extractionResult.purchaseOrder.customer.company || extractionResult.purchaseOrder.customer.email || 'Unknown'}`);
      
      // For forwarded emails, use the customer info from Gemini extraction
      customerInfo = extractionResult.purchaseOrder.customer;
      effectiveSenderForPO = customerInfo.email || messageToProcess.sender;
    }

    // 🔥 UPDATE STATUS: Line Item Validation
    updateProcessingStatus({
      currentStep: "line_item_validation"
    });

    // SKU Validation for extracted line items
    let validatedLineItems: any[] | null = null;
    if (extractionResult?.lineItems?.length > 0) {
      console.log(`\n🤖 OPENAI SKU VALIDATOR: Processing ${extractionResult.lineItems.length} extracted line items...`);
      
      try {
        // Create fresh validator instance for this email to prevent race conditions
        console.log(`   └─ Processing ${extractionResult.lineItems.length} line items for validation`);
        
        // Validate line items with OpenAI using isolated instance
        // Create fresh validator instance for this email to prevent race conditions with health monitoring
        const skuValidator = await validatorHealthService.recordValidatorCall(
          'skuValidator',
          async () => new OpenAISKUValidatorService()
        );
        validatedLineItems = await skuValidator.validateLineItems(extractionResult.lineItems);
        
        console.log(`   ✅ SKU validation complete: ${validatedLineItems?.length || 0} items processed`);
        
        // Merge validated SKUs back into original line items structure
        if (validatedLineItems && validatedLineItems.length > 0 && extractionResult.lineItems) {
          extractionResult.lineItems.forEach((originalItem: any, index: number) => {
            const validatedItem = validatedLineItems?.[index];
            if (validatedItem) {
              // Preserve original structure and add finalSKU
              originalItem.finalSKU = validatedItem.finalSKU || '';
              
              // Log validation results
              if (originalItem.sku !== validatedItem.finalSKU && validatedItem.finalSKU) {
                console.log(`      ${index + 1}. "${originalItem.sku || validatedItem.sku}" → "${validatedItem.finalSKU}"`);
              }
            }
          });
          
          // STEP 3 COMPLETION: Update database immediately with line items validation results
          try {
            const tempPO = await storage.getPurchaseOrderByNumber(poNumber);
            if (tempPO) {
              await storage.updatePurchaseOrder(tempPO.id, {
                lineItems: extractionResult.lineItems,
                extractedData: {
                  ...extractionResult,
                  validatedLineItems: validatedLineItems
                }
              });
              console.log(`   ✅ STEP 3 COMPLETED: Line items data stored in database`);
            }
          } catch (stepError) {
            console.error(`   ❌ STEP 3 FAILED: Could not store line items data:`, stepError);
          }
        }
        
      } catch (error) {
        console.error(`   ❌ SKU validation failed:`, error);
        console.log(`   └─ Continuing with original line items`);
        // Continue without validation rather than failing the entire process
      }
    }

    purchaseOrder = await storage.createPurchaseOrder({
      poNumber,
      emailId: messageToProcess.id,
      sender: effectiveSenderForPO,
      subject: messageToProcess.subject,
      route: processingResult.classification.recommended_route,
      confidence: processingResult.classification.analysis_flags?.confidence_score || 0,
      status: extractionResult ? 
              (customerMeta ? 'ready_for_netsuite' : 'new_customer') : 
              (processingResult.classification.recommended_route === 'TEXT_PO' ? 'ready_for_extraction' : 'pending_review'),
      originalJson: processingResult.classification,
      extractedData: {
        ...extractionResult,
        // Line items now have finalSKU merged in from validation
        forwardedEmail: isForwardedEmail ? {
          originalSender: messageToProcess.sender,
          cNumber: extractedCNumber,
          hclCustomerLookup: hclCustomerLookup,
          extractedCustomer: customerInfo || hclCustomerLookup // Use Gemini extraction first, fallback to HCL lookup
        } : undefined
      },
      lineItems: extractionResult?.lineItems || [], // Store line items with merged finalSKU values
      customerMeta: customerMeta, // Include HCL customer lookup result
      contactMeta: contactMeta, // Include HCL contact lookup result  
      contact: extractionResult?.purchaseOrder?.contact?.name || null // Store contact name for NetSuite
    });
  }

  // Mark as processed in Gmail with preprocessing result
  await gmailService.markAsProcessed(messageToProcess.id, processingResult.preprocessing);

  return { 
    message: `Successfully processed: ${messageToProcess.subject}`,
    processed: 1,
    details: {
      emailId: messageToProcess.id,
      sender: messageToProcess.sender,
      subject: messageToProcess.subject,
      preprocessing: {
        classification: processingResult.preprocessing.response,
        confidence: (processingResult.preprocessing.score && typeof processingResult.preprocessing.score === 'number') ? Math.round(processingResult.preprocessing.score * 100) : null,
        shouldProceed: processingResult.preprocessing.shouldProceed
      },
      classification: processingResult.classification ? {
        route: processingResult.classification.recommended_route,
        confidence: Math.round((processingResult.classification.analysis_flags.confidence_score || 0) * 100),
        hasAttachments: processingResult.classification.analysis_flags.has_attachments,
        requiresReview: processingResult.classification.recommended_route === 'REVIEW'
      } : null,
      purchaseOrder: purchaseOrder ? {
        poNumber: purchaseOrder.poNumber,
        status: purchaseOrder.status,
        extractedData: purchaseOrder.extractedData ? 'Available' : 'None'
      } : null,
      extractionResult: extractionResult ? {
        clientPO: extractionResult.purchaseOrder?.purchaseOrderNumber || 'Not found',
        engine: extractionResult.engine || 'Unknown'
      } : null,
      attachments: attachmentPaths
    }
  };
}

// Enhanced error logging helper for comprehensive tracking
async function logProcessingError(
  type: 'preprocessing_failed' | 'classification_failed' | 'extraction_failed' | 'customer_lookup_failed' | 'sku_validation_failed' | 'final_step_failed' | 'gmail_labeling_failed' | 'ai_filter_failed' | 'contact_validation_failed' | 'attachment_screening_failed' | 'validator_health_alert',
  message: string,
  emailId?: string,
  poId?: string,
  poNumber?: string,
  additionalData?: any
) {
  try {
    // Add user-friendly explanations for each error type
    const errorExplanations: Record<string, string> = {
      'preprocessing_failed': 'Initial email analysis failed. The AI could not determine if this email contains a purchase order or sample request.',
      'classification_failed': 'Email classification failed. Unable to determine the correct processing route (TEXT_PO, ATTACHMENT_PO, etc.).',
      'extraction_failed': 'Data extraction failed. Unable to extract purchase order information from email text or attachments.',
      'customer_lookup_failed': 'Customer matching failed. Could not find this customer in the HCL database - may need manual customer setup.',
      'sku_validation_failed': 'Product validation failed. Line items could not be validated against the HCL product catalog.',
      'final_step_failed': 'Processing completion failed. An error occurred in the final stages of email processing.',
      'gmail_labeling_failed': 'Gmail organization failed. Email was processed but could not be properly labeled for tracking.',
      'ai_filter_failed': 'Attachment screening error. AI filter may have incorrectly rejected a valid purchase order document.',
      'contact_validation_failed': 'Contact resolution failed. Unable to validate or match the contact information from the email.',
      'attachment_screening_failed': 'Attachment analysis failed. Unable to determine which attachments contain purchase order data.',
      'validator_health_alert': 'Validator health issue detected. One or more validation services are experiencing performance problems.'
    };
    
    const explanation = errorExplanations[type] || 'An unexpected error occurred during email processing.';
    
    const errorLog = await storage.createErrorLog({
      type,
      message,
      explanation, // Add explanation to the database
      relatedPoId: poId || null,
      relatedPoNumber: poNumber || null,
      resolved: false,
      metadata: {
        emailId,
        timestamp: new Date().toISOString(),
        step: type.replace('_failed', ''),
        additionalData: additionalData || null
      }
    });
    
    console.error(`🚨 ERROR LOGGED [${type}]: ${message}`);
    console.error(`   └─ Error ID: ${errorLog.id}`);
    console.error(`   └─ Email ID: ${emailId || 'N/A'}`);
    console.error(`   └─ PO Number: ${poNumber || 'N/A'}`);
    console.error(`   └─ What this means: ${explanation}`);
    
    return errorLog;
  } catch (logError) {
    console.error('❌ Failed to log processing error to database:', logError);
    console.error('   └─ Original error:', message);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Register customer routes
  registerCustomerRoutes(app);
  
  // Register contact routes
  registerContactRoutes(app);
  
  // Register items routes
  app.use("/api/items", itemsRouter);
  
  // Register validator health routes
  registerValidatorHealthRoutes(app);
  
  // Register contact embedding routes
  registerContactEmbeddingRoutes(app);
  
  // Register customer embedding routes
  registerCustomerEmbeddingRoutes(app);
  
  // Register item embedding routes
  registerItemEmbeddingRoutes(app);
  
  // Initialize Gmail labels on startup
  try {
    console.log('Initializing Gmail labels...');
    await gmailService.ensureLabelsExist();
    console.log('Gmail labels initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Gmail labels:', error);
  }

  // Auto-start re-enabled after memory optimization success
  setTimeout(async () => {
    console.log('🟢 AUTO-PROCESSING: ENABLED with memory optimizations');
    console.log('⚡ ARCHITECTURE: Automatic processing mode active');
    console.log('🎯 HYBRID VALIDATION: Full system operational');
    
    // Start health monitoring system
    try {
      validatorHealthService.startMonitoring();
      console.log('✅ Health monitoring started successfully');
    } catch (error) {
      console.log('⚠️ Health monitoring disabled due to memory constraints');
    }
    
    // Start lightweight email polling with memory optimizations
    try {
      console.log('📧 Starting lightweight email polling...');
      
      // Create a simple polling function that checks for new emails every 2 minutes
      const pollEmails = async () => {
        try {
          const response = await fetch('http://localhost:5000/api/processing/process-auto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (response.ok) {
            const result = await response.json();
            if (result.processed && result.processed > 0) {
              console.log(`📧 Auto-polling: Processed ${result.processed} email(s)`);
            }
          }
        } catch (error) {
          console.log('📧 Auto-polling: No new emails or service unavailable');
        }
      };
      
      // Start polling every 2 minutes (120000ms)
      setInterval(pollEmails, 120000);
      console.log('✅ Lightweight email polling started (every 2 minutes)');
      
    } catch (error) {
      console.error('❌ Failed to start email polling:', error);
      console.log('📝 Fallback: Use manual API endpoints for processing');
    }
  }, 2000);
  

  
  // Dashboard metrics
  app.get("/api/dashboard/metrics", async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to fetch metrics' 
      });
    }
  });

  // System health
  app.get("/api/system/health", async (req, res) => {
    try {
      const health = await storage.getSystemHealth();
      res.json(health);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to fetch system health' 
      });
    }
  });

  // AI Engine Management
  app.get("/api/ai/engines", async (req, res) => {
    try {
      const config = aiService.getEngineConfiguration();
      res.json(config);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to fetch AI engines' 
      });
    }
  });

  app.post("/api/ai/engines/:engine", async (req, res) => {
    try {
      const engine = req.params.engine as AIEngine;
      if (!['openai', 'gemini'].includes(engine)) {
        return res.status(400).json({ message: 'Invalid AI engine' });
      }
      
      aiService.setEngine(engine);
      res.json({ success: true, current: engine });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to set AI engine' 
      });
    }
  });

  app.get("/api/ai/test", async (req, res) => {
    try {
      const results = await aiService.testConnections();
      res.json(results);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to test AI connections' 
      });
    }
  });

  // Memory health endpoint (OpenAI recommendation)
  app.get("/api/memory/health", async (req, res) => {
    try {
      const { getMemoryStats } = await import('./utils/memory-monitor');
      const stats = getMemoryStats();
      
      res.json({
        ...stats,
        status: stats.heapUsedMB > 700 ? 'pressure' : 'ok',
        recommendation: stats.heapUsedMB > 700 ? 'Consider reducing batch sizes' : 'Memory usage normal'
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get memory stats',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // TEST: Customer number format validation
  app.post("/api/test/customer-format-validation", async (req, res) => {
    try {
      const { testNumbers } = req.body;
      const { CustomerLookupService } = await import("./services/customer-lookup");
      const customerLookup = new CustomerLookupService();
      
      const results = await Promise.all(
        testNumbers.map(async (number: string) => {
          const result = await customerLookup.lookupCustomer({ customerNumber: number });
          return {
            customerNumber: number,
            formatStatus: result.method === 'invalid_format' ? 'INVALID' : 'VALID',
            error: result.validationError || null,
            found: result.customer !== null
          };
        })
      );
      
      res.json(results);
    } catch (error) {
      console.error("Customer format validation test failed:", error);
      res.status(500).json({ error: "Test failed" });
    }
  });

  // TEST: Customer finder with empty data (like PO 28358)
  app.post("/api/test/customer-finder", async (req, res) => {
    try {
      const { customerName, customerEmail, senderEmail } = req.body;
      const { OpenAICustomerFinderService } = await import("./services/openai-customer-finder");
      const customerFinder = new OpenAICustomerFinderService();
      
      const result = await customerFinder.findCustomer({
        customerName,
        customerEmail,
        senderEmail
      });
      
      res.json(result);
    } catch (error) {
      console.error("Customer finder test failed:", error);
      res.status(500).json({ error: "Test failed" });
    }
  });

  // REMOVED: Legacy process-single endpoint - use /api/processing/process-auto instead

  // LEGACY ENDPOINT REMOVED - Use unified /api/processing/process-auto endpoint
  app.post("/api/emails/process-single", async (req, res) => {
    res.status(410).json({
      error: "Endpoint removed",
      message: "Use /api/processing/process-auto for unified email processing",
      redirectTo: "/api/processing/process-auto"
    });
  });

  // SSE endpoint for real-time processing updates - DISABLED FOR NOW
  app.get("/api/emails/process/stream_disabled", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

    res.write('data: {"message":"SSE endpoint disabled - use polling for real-time updates"}\n\n');
    res.end();
  });

  app.get("/api/gmail/test", async (req, res) => {
    try {      
      // Test Gmail connection by fetching inbox messages
      const messages = await gmailService.getMessages('in:inbox');
      res.json({ 
        success: true, 
        connection: 'working',
        message: `Successfully connected to Gmail. Found ${messages.length} messages in inbox.`,
        account: 'hcl@metrixdigital.com',
        sampleMessages: messages.slice(0, 3).map(m => ({
          id: m.id,
          sender: m.sender,
          subject: m.subject,
          date: m.internalDate
        }))
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        connection: 'failed',
        message: error instanceof Error ? error.message : 'Gmail connection failed' 
      });
    }
  });

  // Email queue
  app.get("/api/email-queue", async (req, res) => {
    try {
      const { status, limit } = req.query;
      const queue = await storage.getEmailQueue({
        status: status as string,
        limit: limit ? parseInt(limit as string) : undefined
      });
      res.json(queue);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to fetch email queue' 
      });
    }
  });

  // Processing queue status
  app.get("/api/processing/queue-status", async (req, res) => {
    try {
      const [classification, importReady, newCustomerReview, pendingReview, customerNotFound, errors] = await Promise.all([
        storage.getEmailQueue({ status: 'pending', limit: 100 }),
        storage.getPurchaseOrders({ status: 'customer_found', limit: 100 }),
        storage.getPurchaseOrders({ status: 'new customer', limit: 100 }),
        storage.getPurchaseOrders({ status: 'pending_review', limit: 100 }),
        storage.getPurchaseOrders({ status: 'new customer', limit: 100 }),
        storage.getErrorLogs({ resolved: false, limit: 100 })
      ]);

      res.json({
        classification: classification.length,
        import: importReady.length,
        review: pendingReview.length + newCustomerReview.length + customerNotFound.length,
        errors: errors.length
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to fetch processing queue status' 
      });
    }
  });

  // Current processing status endpoint
  app.get("/api/processing/current-status", async (req, res) => {
    try {
      res.json(currentProcessingStatus);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to get processing status' 
      });
    }
  });

  // Purchase orders endpoint
  app.get("/api/purchase-orders", async (req, res) => {
    try {
      const { status, limit = 50 } = req.query;
      const purchaseOrders = await storage.getPurchaseOrders({
        status: status as string,
        limit: parseInt(limit as string)
      });
      res.json(purchaseOrders);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to fetch purchase orders' 
      });
    }
  });

  // UNIFIED PROCESSING ENDPOINT - All processing goes through validation system
  app.post("/api/processing/process-auto", async (req, res) => {
    console.log('\n🔄 UNIFIED PROCESSING: Manual processing triggered via API endpoint');
    
    try {
      // Check if already processing
      if (currentProcessingStatus.isProcessing) {
        return res.json({
          message: "Already processing an email",
          isProcessing: true,
          currentStep: currentProcessingStatus.currentStep
        });
      }

      // Start the processing workflow
      updateProcessingStatus({
        isProcessing: true,
        currentStep: "starting_processing",
        currentEmail: "Initializing email processing workflow...",
        emailNumber: 0,
        totalEmails: 0
      });
      
      const result = await processEmailWithValidationSystem();
      res.json(result);
    } catch (error) {
      console.error('Unified processing failed:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Processing failed',
        error: 'unified_processing_error'
      });
    } finally {
      // Always reset processing status
      updateProcessingStatus({
        isProcessing: false,
        currentStep: "",
        currentEmail: "",
        currentPO: ""
      });
    }
  });

  const server = createServer(app);
  return server;
};
