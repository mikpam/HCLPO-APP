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
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "./objectStorage";
import { aiService, type AIEngine } from "./services/ai-service";
import { netsuiteService } from "./services/netsuite";
// openaiCustomerFinderService now uses per-email instances to prevent race conditions
import { OpenAISKUValidatorService } from "./services/openai-sku-validator";
import { OpenAIContactValidatorService } from "./services/openai-contact-validator";
import { db } from "./db";
import { purchaseOrders as purchaseOrdersTable, errorLogs, customers, contacts } from "@shared/schema";
import { eq, desc, and, or, lt, sql, isNotNull } from "drizzle-orm";

import { insertPurchaseOrderSchema, insertErrorLogSchema, classificationResultSchema } from "@shared/schema";
import { z } from "zod";

// NOTE: Validator instances are now created per-email to prevent race conditions
// Previously used singleton validators caused state pollution between sequential emails

// 🔥 REAL-TIME PROCESSING STATUS TRACKING (imported from shared module)
import { updateProcessingStatus, getCurrentProcessingStatus, type ProcessingStatus, tryAcquireProcessingLock, releaseProcessingLock } from "./utils/processing-status";

// Initialize object storage service for generating presigned URLs
const objectStorageService = new ObjectStorageService();

// Complete validation system workflow - processes emails with real-time status updates
async function processEmailWithValidationSystem() {
  console.log(`\n🔄 AUTOMATED PROCESSING: Starting automatic email processing through validation system...`);
  
  try {
    // Step 1: Fetch unprocessed emails (lock is already acquired by caller)
    updateProcessingStatus({
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
      releaseProcessingLock({
        currentStep: "completed",
        currentEmail: "No new emails to process - system idle"
      });
      
      return {
        message: "No new emails found to process",
        processed: 0,
        details: null
      };
    }

    // 🛡️ ATOMIC DEDUPLICATION CHECK: Prevent processing the same Gmail message multiple times
    console.log(`\n🛡️ DEDUPLICATION CHECK: Verifying Gmail message ${messageToProcess.id} hasn't been processed...`);
    
    // Check both purchase orders AND email queue to prevent race conditions
    const existingPO = await db
      .select({ id: purchaseOrdersTable.id, poNumber: purchaseOrdersTable.poNumber })
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.emailId, messageToProcess.id))
      .limit(1);
    
    const existingQueue = await storage.getEmailQueueByGmailId(messageToProcess.id);
    
    if (existingPO.length > 0) {
      console.log(`   ❌ DUPLICATE DETECTED: Gmail message ${messageToProcess.id} already processed as PO ${existingPO[0].poNumber}`);
      console.log(`   └─ Skipping duplicate processing to prevent duplicate PO creation`);
      
      releaseProcessingLock({
        currentStep: "completed",
        currentEmail: `Skipped duplicate: ${messageToProcess.subject}`
      });
      
      return {
        message: "Email already processed - skipping duplicate",
        processed: 0,
        details: {
          emailId: messageToProcess.id,
          existingPONumber: existingPO[0].poNumber,
          existingPOId: existingPO[0].id,
          reason: "duplicate_email_id"
        }
      };
    }
    
    if (existingQueue) {
      console.log(`   ❌ PROCESSING IN PROGRESS: Gmail message ${messageToProcess.id} is currently being processed`);
      console.log(`   └─ Queue status: ${existingQueue.status} - skipping to prevent race condition`);
      
      releaseProcessingLock({
        currentStep: "completed",
        currentEmail: `Already processing: ${messageToProcess.subject}`
      });
      
      return {
        message: "Email already being processed - skipping to prevent duplicates",
        processed: 0,
        details: {
          emailId: messageToProcess.id,
          queueStatus: existingQueue.status,
          reason: "processing_in_progress"
        }
      };
    }
    
    console.log(`   ✅ DEDUPLICATION PASSED: Gmail message ${messageToProcess.id} is new - proceeding with processing`);
    
    // 🔒 IMMEDIATE QUEUE RESERVATION: Create email queue record immediately to prevent race conditions
    console.log(`   🔒 ATOMIC LOCK: Creating queue record to prevent duplicate processing...`);
    const queueReservation = await storage.createEmailQueueItem({
      gmailId: messageToProcess.id,
      sender: messageToProcess.sender,
      subject: messageToProcess.subject,
      body: messageToProcess.body,
      attachments: messageToProcess.attachments,
      labels: messageToProcess.labels,
      status: 'processing'
    });

    // Start processing this email (lock already acquired)
    updateProcessingStatus({
      currentStep: "email_preprocessing",
      currentEmail: `${messageToProcess.subject} (${messageToProcess.sender})`,
      emailNumber: 1,
      totalEmails: 1
    });

    console.log(`\n🔄 PROCESSING EMAIL: "${messageToProcess.subject}"`);
    console.log(`   └─ From: ${messageToProcess.sender}`);
    console.log(`   └─ Attachments: ${messageToProcess.attachments.length}`);

    const result = await processEmailThroughValidationSystem(messageToProcess, updateProcessingStatus);
    
    // Release processing lock after successful completion
    releaseProcessingLock({
      currentStep: "completed", 
      currentEmail: `Successfully processed: ${messageToProcess.subject}`
    });
    
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
    releaseProcessingLock({
      currentStep: "error",
      currentEmail: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
    throw error;
  }
}

// Helper function to process email through complete validation system
async function processEmailThroughValidationSystem(messageToProcess: any, updateProcessingStatus: Function) {
  updateProcessingStatus({
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

  // Email queue item already created during atomic lock - use existing reservation

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
  let extractionSourceFile = null; // Track which specific file was used for extraction
  let attachmentPaths: Array<{filename: string; storagePath: string; buffer?: Buffer}> = [];
  let emlFilePath = null;

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
      
      emlFilePath = await objectStorageService.storeEmailFile(
        messageToProcess.id,
        messageToProcess.subject,
        rawEmailContent
      );
      
      console.log(`   ✅ Email preserved at: ${emlFilePath}`);
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
                
                // Track which specific file was used for successful extraction
                extractionSourceFile = pdfAttachment.storagePath;
                
                console.log(`   ✅ SUCCESS: Extracted PO data from PDF`);
                console.log(`   └─ Extraction source: ${pdfAttachment.filename} (${pdfAttachment.storagePath})`);
                console.log(`   └─ Client PO Number: ${extractionResult?.purchaseOrder?.purchaseOrderNumber || 'NOT FOUND'}`);
                if (extractionResult?.purchaseOrder?.customer?.company) {
                  console.log(`   └─ Customer: ${extractionResult.purchaseOrder.customer.company}`);
                }
                if (extractionResult?.lineItems?.length) {
                  console.log(`   └─ Line Items: ${extractionResult.lineItems.length}`);
                }
                
                // 🔥 IMMEDIATE STORAGE: Store extraction data right after successful extraction
                // This ensures validators can access the extracted data, and prevents data loss if validation fails
                console.log(`   💾 IMMEDIATE STORAGE: Saving Gemini extraction data to database...`);
                
                try {
                  // Create preliminary PO record with extraction data immediately
                  const preliminaryPONumber = extractionResult?.purchaseOrder?.purchaseOrderNumber || 
                                            extractionResult?.purchaseOrderNumber ||
                                            extractionResult?.clientPONumber ||
                                            `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
                  
                  // Check if PO already exists and create unique number if needed
                  let finalPONumber = preliminaryPONumber;
                  let suffix = 1;
                  while (await storage.getPurchaseOrderByNumber(finalPONumber)) {
                    finalPONumber = `${preliminaryPONumber}-${suffix}`;
                    suffix++;
                  }
                  
                  // Create purchase order immediately with extraction data
                  purchaseOrder = await storage.createPurchaseOrder({
                    poNumber: finalPONumber,
                    emailId: messageToProcess.id,
                    sender: messageToProcess.sender,
                    subject: messageToProcess.subject,
                    route: processingResult.classification.recommended_route,
                    confidence: processingResult.classification.analysis_flags?.confidence_score || 0,
                    status: 'extracting', // Temporary status during processing
                    originalJson: processingResult.classification,
                    extractedData: extractionResult, // Store the complete Gemini extraction
                    lineItems: extractionResult?.lineItems || [],
                    contact: extractionResult?.purchaseOrder?.contact?.name || null,
                    customerName: extractionResult?.purchaseOrder?.customer?.company || null,
                    emlFilePath: emlFilePath,
                    extractionSourceFile: extractionSourceFile,
                    attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths.map(att => att.storagePath) : []
                  });
                  
                  console.log(`   ✅ IMMEDIATE STORAGE COMPLETE: PO ${finalPONumber} created with extraction data`);
                  console.log(`   └─ Database ID: ${purchaseOrder.id}`);
                  
                } catch (storageError) {
                  console.error(`   ❌ IMMEDIATE STORAGE FAILED:`, storageError);
                  // Continue processing even if immediate storage fails
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
          
          // 🔄 FALLBACK MECHANISM: If all attachments were filtered out, try extracting from email body text
          console.log(`\n🔄 FALLBACK: Attempting to extract PO data from email body text...`);
          try {
            extractionResult = await aiService.extractPODataFromText(
              messageToProcess.subject,
              messageToProcess.body,
              messageToProcess.sender
            );
            
            if (extractionResult && (extractionResult.purchaseOrder || extractionResult.lineItems?.length > 0)) {
              console.log(`   ✅ FALLBACK SUCCESS: Found PO data in email body text`);
              console.log(`   └─ Client PO Number: ${extractionResult?.purchaseOrder?.purchaseOrderNumber || extractionResult?.clientPONumber || 'NOT FOUND'}`);
              if (extractionResult?.purchaseOrder?.customer?.company) {
                console.log(`   └─ Customer: ${extractionResult.purchaseOrder.customer.company}`);
              }
              if (extractionResult?.lineItems?.length) {
                console.log(`   └─ Line Items: ${extractionResult.lineItems.length}`);
              }
              
              // Create PO record with fallback extraction data
              console.log(`   💾 FALLBACK STORAGE: Saving email text extraction data to database...`);
              
              const preliminaryPONumber = extractionResult?.purchaseOrder?.purchaseOrderNumber || 
                                        extractionResult?.purchaseOrderNumber ||
                                        extractionResult?.clientPONumber ||
                                        `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
              
              // Check if PO already exists and create unique number if needed
              let finalPONumber = preliminaryPONumber;
              let suffix = 1;
              while (await storage.getPurchaseOrderByNumber(finalPONumber)) {
                finalPONumber = `${preliminaryPONumber}-${suffix}`;
                suffix++;
              }
              
              // Create purchase order with fallback extraction data
              purchaseOrder = await storage.createPurchaseOrder({
                poNumber: finalPONumber,
                emailId: messageToProcess.id,
                sender: messageToProcess.sender,
                subject: messageToProcess.subject,
                route: 'ATTACHMENT_PO_FALLBACK', // Special route to indicate fallback was used
                confidence: processingResult.classification.analysis_flags?.confidence_score || 0,
                status: 'extracting',
                originalJson: processingResult.classification,
                extractedData: extractionResult,
                lineItems: extractionResult?.lineItems || [],
                contact: extractionResult?.purchaseOrder?.contact?.name || null,
                customerName: extractionResult?.purchaseOrder?.customer?.company || null,
                emlFilePath: emlFilePath,
                extractionSourceFile: null, // No specific file, extracted from email body
                attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths.map(att => att.storagePath) : []
              });
              
              console.log(`   ✅ FALLBACK STORAGE COMPLETE: PO ${finalPONumber} created with email text extraction`);
              console.log(`   └─ Database ID: ${purchaseOrder.id}`);
              
              processedPO = true; // Mark as processed
              
            } else {
              console.log(`   ❌ FALLBACK FAILED: No PO data found in email body text either`);
            }
            
          } catch (fallbackError) {
            console.error(`   ❌ FALLBACK EXTRACTION FAILED:`, fallbackError);
          }
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
        
        // For TEXT_PO, extraction source is the email body (no specific attachment file)
        extractionSourceFile = null;
        
        console.log(`   ✅ SUCCESS: Extracted PO data from email text`);
        console.log(`   └─ Extraction source: Email body text`);
        console.log(`   └─ Client PO Number: ${extractionResult?.purchaseOrder?.purchaseOrderNumber || 'NOT FOUND'}`);
        if (extractionResult?.purchaseOrder?.customer?.company) {
          console.log(`   └─ Customer: ${extractionResult.purchaseOrder.customer.company}`);
        }
        if (extractionResult?.lineItems?.length) {
          console.log(`   └─ Line Items: ${extractionResult.lineItems.length}`);
        }
        
        // 🔥 IMMEDIATE STORAGE: Store TEXT_PO extraction data right after successful extraction
        console.log(`   💾 IMMEDIATE STORAGE: Saving Gemini TEXT extraction data to database...`);
        
        try {
          // Create preliminary PO record with extraction data immediately
          const preliminaryPONumber = extractionResult?.purchaseOrder?.purchaseOrderNumber || 
                                    extractionResult?.purchaseOrderNumber ||
                                    extractionResult?.clientPONumber ||
                                    `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
          
          // Check if PO already exists and create unique number if needed
          let finalPONumber = preliminaryPONumber;
          let suffix = 1;
          while (await storage.getPurchaseOrderByNumber(finalPONumber)) {
            finalPONumber = `${preliminaryPONumber}-${suffix}`;
            suffix++;
          }
          
          // Create purchase order immediately with extraction data
          purchaseOrder = await storage.createPurchaseOrder({
            poNumber: finalPONumber,
            emailId: messageToProcess.id,
            sender: messageToProcess.sender,
            subject: messageToProcess.subject,
            route: processingResult.classification.recommended_route,
            confidence: processingResult.classification.analysis_flags?.confidence_score || 0,
            status: 'extracting', // Temporary status during processing
            originalJson: processingResult.classification,
            extractedData: extractionResult, // Store the complete Gemini extraction
            lineItems: extractionResult?.lineItems || [],
            contact: extractionResult?.purchaseOrder?.contact?.name || null,
            customerName: extractionResult?.purchaseOrder?.customer?.company || null,
            emlFilePath: emlFilePath,
            extractionSourceFile: extractionSourceFile,
            attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths.map(att => att.storagePath) : []
          });
          
          console.log(`   ✅ IMMEDIATE STORAGE COMPLETE: PO ${finalPONumber} created with extraction data`);
          console.log(`   └─ Database ID: ${purchaseOrder.id}`);
          
        } catch (storageError) {
          console.error(`   ❌ IMMEDIATE STORAGE FAILED:`, storageError);
          // Continue processing even if immediate storage fails
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
        resolvedCustomerId: (customerMeta as any)?.customer_number,
        companyId: (customerMeta as any)?.customer_number
      });
      
      contactMeta = validatedContact;
      console.log(`   ✅ Contact validated: ${validatedContact.name} <${validatedContact.email}>`);
      console.log(`   └─ Method: ${validatedContact.match_method} (Confidence: ${validatedContact.confidence})`);
      console.log(`   └─ Role: ${validatedContact.role}`);
      console.log(`   └─ Evidence: ${validatedContact.evidence?.join(', ') || 'None provided'}`);
      
      // STEP 2 COMPLETION: Update database immediately with contact validation results
      try {
        if (purchaseOrder) {
          await storage.updatePurchaseOrder(purchaseOrder.id, {
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
            if (purchaseOrder) {
              await storage.updatePurchaseOrder(purchaseOrder.id, {
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
          
          // STEP 3 COMPLETION: Update existing purchase order with line items validation results
          try {
            if (purchaseOrder) {
              await storage.updatePurchaseOrder(purchaseOrder.id, {
                lineItems: extractionResult.lineItems,
                extractedData: {
                  ...extractionResult,
                  validatedLineItems: validatedLineItems
                },
                status: 'validating' // Update status to show validation in progress
              });
              console.log(`   ✅ STEP 3 COMPLETED: Line items data stored in existing PO ${purchaseOrder.poNumber}`);
            } else {
              console.log(`   ⚠️ STEP 3 SKIPPED: No purchase order available for update`);
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
      status: extractionResult ? 'validating' : 
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
      contact: extractionResult?.purchaseOrder?.contact?.name || null, // Store contact name for NetSuite
      emlFilePath: emlFilePath, // Store EML file path for email preservation
      extractionSourceFile: extractionSourceFile, // Store specific file used for successful extraction
      attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths.map(att => att.storagePath) : [] // Store attachment paths as array for proper access
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
  
  // Enhanced Company Analysis route
  const enhancedAnalysisRouter = (await import('./routes/enhanced-company-analysis')).default;
  app.use("/api/analysis", enhancedAnalysisRouter);
  
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
          console.log('📧 Auto-polling: Checking for new emails...');
          
          // Try to acquire processing lock for automated processing
          const lockAcquired = tryAcquireProcessingLock({
            currentStep: "auto_polling",
            currentEmail: "Checking for new emails via auto-polling...",
            emailNumber: 0,
            totalEmails: 0
          });

          if (!lockAcquired) {
            console.log('📧 Auto-polling: System busy processing - will try again in 2 minutes');
            return; // Another process is running, skip this cycle
          }
          
          try {
            const result = await processEmailWithValidationSystem();
            if (result.processed && result.processed > 0) {
              console.log(`📧 Auto-polling: Successfully processed ${result.processed} email(s)`);
            } else {
              console.log('📧 Auto-polling: No new emails to process');
            }
          } catch (error) {
            console.log('📧 Auto-polling error:', error.message);
            releaseProcessingLock({
              currentStep: "error",
              currentEmail: `Auto-polling error: ${error.message}`
            });
          }
        } catch (error) {
          console.log('📧 Auto-polling: System error or no new emails');
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
  

  
  // Force validation endpoint for debugging unvalidated POs with retry limits
  app.post("/api/force-validation/:poId", async (req, res) => {
    try {
      const { poId } = req.params;
      
      console.log(`🔧 FORCE VALIDATION: Starting validation for PO ID ${poId}`);
      
      // Get the purchase order by UUID
      const purchaseOrder = await storage.getPurchaseOrder(poId);
      if (!purchaseOrder) {
        return res.status(404).json({ error: `PO with ID ${poId} not found` });
      }
      
      console.log(`   └─ Found PO: ${purchaseOrder.id} (Current retry count: ${purchaseOrder.retryCount || 0})`);
      
      // 🛡️ RETRY LIMIT: Check if maximum retries exceeded (3 attempts)
      const currentRetryCount = purchaseOrder.retryCount || 0;
      if (currentRetryCount >= 3) {
        console.log(`   ❌ RETRY LIMIT EXCEEDED: PO has already been retried ${currentRetryCount} times (max: 3)`);
        return res.status(400).json({ 
          error: `Retry limit exceeded: PO has been retried ${currentRetryCount} times (maximum: 3)`,
          poId: purchaseOrder.id,
          poNumber: purchaseOrder.poNumber,
          retryCount: currentRetryCount,
          suggestion: "Manual review required - check for systematic issues with this PO"
        });
      }
      
      console.log(`   🔄 RETRY ATTEMPT ${currentRetryCount + 1}/3: Proceeding with validation...`);
      
      // Reset validation flags and increment retry count
      await storage.updatePurchaseOrder(purchaseOrder.id, {
        customerValidated: false,
        contactValidated: false,
        lineItemsValidated: false,
        validationCompleted: false,
        retryCount: currentRetryCount + 1,
        lastRetryAt: new Date()
      });
      
      const results = {
        poNumber: purchaseOrder.poNumber,
        poId: purchaseOrder.id,
        customer: null,
        contact: null,
        lineItems: null,
        errors: []
      };
      
      // Force customer validation using hybrid validator
      try {
        console.log(`   🔍 Running hybrid customer validation...`);
        
        const extractedData = purchaseOrder.extractedData as any;
        const customer = extractedData?.purchaseOrder?.customer || {};
        
        // Import and create validator instance
        const { HybridCustomerValidator } = await import('./services/hybrid-customer-validator');
        const hybridValidator = new HybridCustomerValidator();
        
        // Prepare input for hybrid validator
        const validationInput = {
          customerName: customer.company || customer.customerName,
          customerEmail: customer.email || purchaseOrder.sender,
          senderEmail: purchaseOrder.sender || undefined,
          customerNumber: customer.customerNumber,
          contactName: customer.contactName,
          address: customer.address
        };
        
        console.log(`   └─ Input:`, validationInput);
        
        // Run hybrid validation
        const customerResult = await hybridValidator.validateCustomer(validationInput);
        
        console.log(`   └─ Result:`, customerResult);
        
        results.customer = customerResult as any;
        
        // Update database with customer validation results
        if (customerResult.matched) {
          const customerMeta = {
            method: customerResult.method,
            status: "found",
            resolved: true,
            confidence: customerResult.confidence,
            customer_name: customerResult.customerName,
            customer_number: customerResult.customerNumber
          };
          
          await storage.updatePurchaseOrder(purchaseOrder.id, {
            customerMeta: customerMeta,
            customerValidated: true
          });
          
          console.log(`   ✅ Customer validation completed: ${customerResult.customerName} (${customerResult.customerNumber})`);
        } else {
          console.log(`   ❌ Customer validation failed: ${customerResult.reasons.join(', ')}`);
        }
        
      } catch (error) {
        console.error(`   ❌ Customer validation error:`, error);
        results.errors.push(`Customer validation error: ${(error as Error).message}`);
      }
      
      // Force contact validation
      try {
        console.log(`   📞 Running contact validation...`);
        
        const contactValidator = await validatorHealthService.recordValidatorCall(
          'contactValidator',
          async () => new OpenAIContactValidatorService()
        );
        
        const contactResult = await contactValidator.validateContact(purchaseOrder.sender);
        
        results.contact = contactResult;
        
        if (contactResult.isValidated) {
          await storage.updatePurchaseOrder(purchaseOrder.id, {
            contactMeta: {
              name: contactResult.contact.name,
              email: contactResult.contact.email,
              phone: contactResult.contact.phone,
              role: contactResult.contact.role,
              evidence: contactResult.evidence,
              confidence: contactResult.confidence,
              match_method: contactResult.matchMethod,
              matched_contact_id: contactResult.matchedContactId || ""
            },
            contactValidated: true
          });
          
          console.log(`   ✅ Contact validation completed: ${contactResult.contact.name} <${contactResult.contact.email}>`);
        } else {
          console.log(`   ❌ Contact validation failed`);
        }
        
      } catch (error) {
        console.error(`   ❌ Contact validation error:`, error);
        results.errors.push(`Contact validation error: ${(error as Error).message}`);
      }
      
      // Force line items validation
      try {
        console.log(`   📦 Running line items validation...`);
        
        const extractedData = purchaseOrder.extractedData as any;
        const lineItems = extractedData?.lineItems || [];
        
        if (lineItems.length > 0) {
          const skuValidator = await validatorHealthService.recordValidatorCall(
            'skuValidator',
            async () => new OpenAISKUValidatorService()
          );
          
          const validatedLineItems = await skuValidator.validateLineItems(lineItems);
          
          results.lineItems = validatedLineItems;
          
          // Update line items with finalSKU
          if (validatedLineItems && validatedLineItems.length > 0) {
            lineItems.forEach((originalItem: any, index: number) => {
              const validatedItem = validatedLineItems[index];
              if (validatedItem) {
                originalItem.finalSKU = validatedItem.finalSKU || '';
              }
            });
            
            await storage.updatePurchaseOrder(purchaseOrder.id, {
              lineItems: lineItems,
              lineItemsValidated: true
            });
            
            console.log(`   ✅ Line items validation completed: ${validatedLineItems.length} items processed`);
          }
        } else {
          console.log(`   ⚠️ No line items found to validate`);
        }
        
      } catch (error) {
        console.error(`   ❌ Line items validation error:`, error);
        results.errors.push(`Line items validation error: ${(error as Error).message}`);
      }
      
      // Mark validation as completed
      await storage.updatePurchaseOrder(purchaseOrder.id, {
        validationCompleted: true
      });
      
      console.log(`✅ FORCE VALIDATION COMPLETED: PO ${purchaseOrder.poNumber}`);
      
      res.json({
        success: true,
        message: `Force validation completed for PO ${purchaseOrder.poNumber}`,
        retryAttempt: currentRetryCount + 1,
        maxRetries: 3,
        results
      });
      
    } catch (error) {
      console.error(`❌ Force validation failed:`, error);
      res.status(500).json({ 
        error: `Force validation failed: ${(error as Error).message}`,
        success: false 
      });
    }
  });

  // Batch validation endpoint for fixing all unvalidated POs
  app.post("/api/batch-validation", async (req, res) => {
    try {
      console.log(`🔧 BATCH VALIDATION: Starting validation for all unvalidated POs`);
      
      // Check if already processing - RESPECT SEQUENTIAL ARCHITECTURE
      if (getCurrentProcessingStatus().isProcessing) {
        return res.json({
          message: "Cannot start batch validation - system is already processing emails",
          isProcessing: true,
          currentStep: getCurrentProcessingStatus().currentStep
        });
      }

      // Set processing lock to prevent concurrent email processing
      updateProcessingStatus({
        isProcessing: true,
        currentStep: "batch_validation",
        currentEmail: "Running batch validation of unvalidated POs...",
        emailNumber: 0,
        totalEmails: 0
      });
      
      // Get all unvalidated POs
      const unvalidatedPOs = await db
        .select({ poNumber: purchaseOrdersTable.poNumber, id: purchaseOrdersTable.id })
        .from(purchaseOrdersTable)
        .where(eq(purchaseOrdersTable.validationCompleted, false))
        .orderBy(purchaseOrdersTable.poNumber);
      
      if (unvalidatedPOs.length === 0) {
        return res.json({ 
          success: true, 
          message: "No unvalidated POs found",
          totalProcessed: 0,
          results: []
        });
      }
      
      console.log(`   └─ Found ${unvalidatedPOs.length} unvalidated POs`);
      
      const batchResults = {
        totalProcessed: unvalidatedPOs.length,
        successful: 0,
        failed: 0,
        results: [] as any[]
      };
      
      // Process each PO
      for (const po of unvalidatedPOs) {
        try {
          console.log(`   🔍 Processing PO ${po.poNumber}...`);
          
          // Force validation using the same logic as single PO endpoint
          const response = await fetch(`http://localhost:5000/api/force-validation/${po.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (response.ok) {
            const result = await response.json();
            batchResults.successful++;
            batchResults.results.push({
              poNumber: po.poNumber,
              success: true,
              customer: result.results?.customer?.matched || false,
              customerName: result.results?.customer?.customerName || 'Unknown',
              customerNumber: result.results?.customer?.customerNumber || null
            });
            console.log(`   ✅ PO ${po.poNumber}: Success`);
          } else {
            batchResults.failed++;
            batchResults.results.push({
              poNumber: po.poNumber,
              success: false,
              error: `HTTP ${response.status}`
            });
            console.log(`   ❌ PO ${po.poNumber}: Failed (${response.status})`);
          }
        } catch (error) {
          batchResults.failed++;
          batchResults.results.push({
            poNumber: po.poNumber,
            success: false,
            error: (error as Error).message
          });
          console.error(`   ❌ PO ${po.poNumber}: ${(error as Error).message}`);
        }
        
        // Small delay to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      console.log(`✅ BATCH VALIDATION COMPLETED: ${batchResults.successful} successful, ${batchResults.failed} failed`);
      
      res.json({
        success: true,
        message: `Batch validation completed: ${batchResults.successful} successful, ${batchResults.failed} failed`,
        ...batchResults
      });
      
    } catch (error) {
      console.error(`❌ Batch validation failed:`, error);
      res.status(500).json({ 
        error: `Batch validation failed: ${(error as Error).message}`,
        success: false 
      });
    } finally {
      // Always release the processing lock to restore sequential processing
      updateProcessingStatus({
        isProcessing: false,
        currentStep: "idle",
        currentEmail: "",
        currentPO: "",
        emailNumber: 0,
        totalEmails: 0
      });
    }
  });

  // Object Storage Routes (must be before static file serving)
  app.get("/objects/:objectPath(*)", async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    try {
      // Handle single file path (not semicolon-separated)
      const singleObjectPath = req.path.split(';')[0]; // Take only first path if multiple
      console.log(`📁 Serving object: ${singleObjectPath}`);
      
      const objectFile = await objectStorageService.getObjectEntityFile(
        singleObjectPath,
      );
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "File not found" });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  });

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

  // Company cross-reference analysis endpoint
  // Enhanced Company Analysis route
  app.post("/api/analysis/enhanced-analysis", async (req, res) => {
    try {
      console.log('\n🤖 ENHANCED COMPANY ANALYSIS: Starting OpenAI-powered analysis...');
      
      const { enhancedCompanyAnalysis } = await import('./routes/enhanced-company-analysis');
      const result = await enhancedCompanyAnalysis();
      
      res.json(result);
    } catch (error) {
      console.error('❌ Enhanced analysis failed:', error);
      res.status(500).json({ 
        error: 'Failed to perform enhanced analysis',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/analysis/company-crossref", async (req, res) => {
    try {
      console.log("🔍 COMPANY CROSS-REFERENCE: Starting analysis...");
      
      // Get all unique companies from contacts (exclude empty/null values)
      const contactCompanies = await db
        .select({ 
          company: sql<string>`DISTINCT TRIM(${contacts.company})`,
          contactCount: sql<number>`count(*)`
        })
        .from(contacts)
        .where(
          and(
            isNotNull(contacts.company),
            sql`TRIM(${contacts.company}) != ''`,
            sql`TRIM(${contacts.company}) NOT ILIKE '%high caliber%'`, // Exclude HCL internal
            sql`TRIM(${contacts.company}) NOT ILIKE '%hcl%'` // Exclude HCL variations
          )
        )
        .groupBy(sql`TRIM(${contacts.company})`)
        .orderBy(sql<number>`count(*) DESC`);

      console.log(`📊 Found ${contactCompanies.length} unique companies in contacts database`);

      // Get all companies from customers database for comparison
      const customerCompanies = await db
        .select({ 
          companyName: customers.companyName,
          customerNumber: customers.customerNumber,
          isActive: customers.isActive
        })
        .from(customers)
        .where(
          and(
            isNotNull(customers.companyName),
            sql`TRIM(${customers.companyName}) != ''`
          )
        );

      console.log(`📊 Found ${customerCompanies.length} companies in customers database`);

      // Create lookup set for faster searching
      const customerCompanySet = new Set(
        customerCompanies.map(c => c.companyName.toLowerCase().trim())
      );

      // Find companies from contacts that are NOT in customers database
      const missingCompanies = [];
      const foundCompanies = [];

      for (const contactCompany of contactCompanies) {
        const companyName = contactCompany.company.toLowerCase().trim();
        
        // Check for exact match first
        if (customerCompanySet.has(companyName)) {
          foundCompanies.push({
            contactCompany: contactCompany.company,
            contactCount: contactCompany.contactCount,
            matchType: 'exact'
          });
        } else {
          // Check for partial matches (fuzzy matching)
          let foundMatch = false;
          for (const customerCompany of customerCompanies) {
            const customerName = customerCompany.companyName.toLowerCase().trim();
            
            // Check if either contains the other (partial matching)
            if (companyName.includes(customerName) || customerName.includes(companyName)) {
              foundCompanies.push({
                contactCompany: contactCompany.company,
                contactCount: contactCompany.contactCount,
                matchType: 'partial',
                customerMatch: customerCompany.companyName
              });
              foundMatch = true;
              break;
            }
          }
          
          if (!foundMatch) {
            missingCompanies.push({
              company: contactCompany.company,
              contactCount: contactCompany.contactCount
            });
          }
        }
      }

      // Sort missing companies by contact count (highest first)
      missingCompanies.sort((a, b) => b.contactCount - a.contactCount);

      // Get top 20 missing companies with most contacts
      const topMissingCompanies = missingCompanies.slice(0, 20);

      console.log(`✅ CROSS-REFERENCE COMPLETE: ${missingCompanies.length} companies missing from customer database`);

      res.json({
        summary: {
          totalContactCompanies: contactCompanies.length,
          totalCustomerCompanies: customerCompanies.length,
          matchedCompanies: foundCompanies.length,
          missingCompanies: missingCompanies.length
        },
        topMissingCompanies,
        allMissingCompanies: missingCompanies,
        exactMatches: foundCompanies.filter(f => f.matchType === 'exact').length,
        partialMatches: foundCompanies.filter(f => f.matchType === 'partial').length
      });

    } catch (error) {
      console.error("Error in company cross-reference analysis:", error);
      res.status(500).json({ 
        error: "Failed to perform company cross-reference analysis",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Download missing companies as CSV
  app.get("/api/analysis/missing-companies/download", async (req, res) => {
    try {
      console.log(`🔍 COMPANY CROSS-REFERENCE: Starting CSV download analysis...`);
      
      // Get all companies from contacts database (excluding HCL internal)
      const contactCompanies = await db
        .select({ 
          company: sql<string>`TRIM(${contacts.company})`,
          contactCount: sql<number>`count(*)`
        })
        .from(contacts)
        .where(
          and(
            isNotNull(contacts.company),
            sql`TRIM(${contacts.company}) != ''`,
            sql`TRIM(${contacts.company}) NOT ILIKE '%high caliber%'`, // Exclude HCL internal
            sql`TRIM(${contacts.company}) NOT ILIKE '%hcl%'` // Exclude HCL variations
          )
        )
        .groupBy(sql`TRIM(${contacts.company})`)
        .orderBy(sql<number>`count(*) DESC`);

      // Get all companies from customers database for comparison
      const customerCompanies = await db
        .select({ 
          companyName: customers.companyName,
          customerNumber: customers.customerNumber,
          isActive: customers.isActive
        })
        .from(customers)
        .where(
          and(
            isNotNull(customers.companyName),
            sql`TRIM(${customers.companyName}) != ''`
          )
        );

      // Create lookup set for faster searching
      const customerCompanySet = new Set(
        customerCompanies.map(c => c.companyName.toLowerCase().trim())
      );

      // Find companies from contacts that are NOT in customers database
      const missingCompanies = [];

      for (const contactCompany of contactCompanies) {
        const companyName = contactCompany.company.toLowerCase().trim();
        
        // Check for exact match first
        if (!customerCompanySet.has(companyName)) {
          // Check for partial matches (fuzzy matching)
          let foundMatch = false;
          for (const customerCompany of customerCompanies) {
            const customerName = customerCompany.companyName.toLowerCase().trim();
            
            // Check if either contains the other (partial matching)
            if (companyName.includes(customerName) || customerName.includes(companyName)) {
              foundMatch = true;
              break;
            }
          }
          
          if (!foundMatch) {
            missingCompanies.push({
              company: contactCompany.company,
              contactCount: contactCompany.contactCount
            });
          }
        }
      }

      // Sort missing companies by contact count (highest first)
      missingCompanies.sort((a, b) => b.contactCount - a.contactCount);

      // Generate CSV content
      const csvHeader = 'Company Name,Contact Count\n';
      const csvRows = missingCompanies
        .map(company => `"${company.company.replace(/"/g, '""')}",${company.contactCount}`)
        .join('\n');
      const csvContent = csvHeader + csvRows;

      // Set headers for file download
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `missing-companies-${timestamp}.csv`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', Buffer.byteLength(csvContent));
      
      console.log(`📄 Generated CSV with ${missingCompanies.length} missing companies`);
      res.send(csvContent);

    } catch (error) {
      console.error("Error generating missing companies CSV:", error);
      res.status(500).json({ 
        error: "Failed to generate missing companies CSV",
        details: error instanceof Error ? error.message : 'Unknown error'
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
      const { customerLookupService } = await import("./services/customer-lookup");
      const customerLookup = customerLookupService;
      
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
      res.json(getCurrentProcessingStatus());
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to get processing status' 
      });
    }
  });

  // 🔧 POST /api/purchase-orders/fix-extraction-data - Fix missing extraction data for specific POs
  app.post('/api/purchase-orders/fix-extraction-data', async (req, res) => {
    try {
      const { targetSubject, extractedData } = req.body;
      
      if (!targetSubject || !extractedData) {
        return res.status(400).json({ 
          error: 'Missing required fields: targetSubject and extractedData' 
        });
      }
      
      console.log(`🔧 EXTRACTION DATA FIX: Searching for PO with subject containing: ${targetSubject}`);
      
      // Find PO by subject or PO number
      const allPOs = await storage.getPurchaseOrders({ limit: 1000 });
      const targetPO = allPOs.find(po => 
        po.subject?.includes(targetSubject) || 
        po.poNumber === targetSubject ||
        po.poNumber?.includes(targetSubject)
      );
      
      if (!targetPO) {
        return res.status(404).json({ 
          error: `No purchase order found with subject/PO number containing: ${targetSubject}` 
        });
      }
      
      console.log(`   ✅ Found PO: ${targetPO.id} (${targetPO.poNumber})`);
      console.log(`   └─ Current extraction data: ${targetPO.extractedData ? 'Present' : 'Missing'}`);
      
      // Update the PO with the provided extraction data
      const updatedPO = await storage.updatePurchaseOrder(targetPO.id, {
        extractedData: extractedData,
        lineItems: extractedData.lineItems || [],
        contact: extractedData.purchaseOrder?.contact?.name || targetPO.contact,
        customerName: extractedData.purchaseOrder?.customer?.company || targetPO.customerName,
        updatedAt: new Date()
      });
      
      console.log(`   ✅ Successfully updated PO with extraction data`);
      console.log(`   └─ Contact: ${extractedData.purchaseOrder?.contact?.name || 'Not provided'}`);
      console.log(`   └─ Company: ${extractedData.purchaseOrder?.customer?.company || 'Not provided'}`);
      console.log(`   └─ Line Items: ${extractedData.lineItems?.length || 0}`);
      
      res.json({
        success: true,
        message: 'Extraction data updated successfully',
        poNumber: targetPO.poNumber,
        updatedFields: {
          extractedData: 'Updated',
          lineItems: extractedData.lineItems?.length || 0,
          contact: extractedData.purchaseOrder?.contact?.name || null,
          customerName: extractedData.purchaseOrder?.customer?.company || null
        }
      });
      
    } catch (error) {
      console.error('❌ Error fixing extraction data:', error);
      res.status(500).json({ 
        error: 'Failed to fix extraction data',
        details: error.message 
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

  // MANUAL PROCESSING COMPLETELY DISABLED - AUTOMATED ONLY
  app.post("/api/processing/process-auto", async (req, res) => {
    return res.status(403).json({
      error: "Manual processing permanently disabled",
      message: "System operates in fully automated mode only - no manual processing allowed",
      automation_status: "AUTOMATED_ONLY",
      note: "All email processing happens automatically via internal polling - no manual triggers"
    });
  });

  // Files listing endpoint for File Management page
  app.get("/api/files", async (req, res) => {
    try {
      console.log('📂 Fetching stored files from database...');

      // Get all file paths from purchase_orders
      const result = await db.select({
        po_number: purchaseOrdersTable.poNumber,
        eml_file_path: purchaseOrdersTable.emlFilePath,
        attachment_paths: purchaseOrdersTable.attachmentPaths,
        extraction_source_file: purchaseOrdersTable.extractionSourceFile,
        created_at: purchaseOrdersTable.createdAt,
        subject: purchaseOrdersTable.subject
      }).from(purchaseOrdersTable)
        .where(
          or(
            isNotNull(purchaseOrdersTable.emlFilePath),
            isNotNull(purchaseOrdersTable.attachmentPaths),
            isNotNull(purchaseOrdersTable.extractionSourceFile)
          )
        )
        .orderBy(desc(purchaseOrdersTable.createdAt));

      // Transform database results into file list format
      const files: any[] = [];

      for (const record of result) {
        // Add EML file if exists
        if (record.eml_file_path) {
          files.push({
            id: `eml_${record.po_number}`,
            filename: `${record.po_number || 'email'}.eml`,
            size: 0, // Size not stored in DB
            uploadedAt: record.created_at,
            contentType: 'message/rfc822',
            storagePath: record.eml_file_path,
            source: 'email',
            description: record.subject || 'Email file'
          });
        }

        // Add attachment files if exist
        if (record.attachment_paths && Array.isArray(record.attachment_paths)) {
          record.attachment_paths.forEach((path: string, index: number) => {
            const filename = path.split('/').pop() || `attachment_${index}`;
            files.push({
              id: `att_${record.po_number}_${index}`,
              filename: filename,
              size: 0, // Size not stored in DB
              uploadedAt: record.created_at,
              contentType: path.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
              storagePath: path,
              source: 'attachment',
              description: `Attachment for ${record.po_number}`
            });
          });
        }

        // Add extraction source file if exists
        if (record.extraction_source_file) {
          const filename = record.extraction_source_file.split('/').pop() || 'source_document';
          files.push({
            id: `src_${record.po_number}`,
            filename: filename,
            size: 0,
            uploadedAt: record.created_at,
            contentType: filename.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
            storagePath: record.extraction_source_file,
            source: 'extraction_source',
            description: `Source document for ${record.po_number}`
          });
        }
      }

      console.log(`✅ Found ${files.length} stored files across ${result.length} purchase orders`);
      res.json(files);

    } catch (error) {
      console.error('❌ Error fetching files:', error);
      res.status(500).json({ 
        error: 'Failed to fetch files',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // File viewing endpoint for EML and other files  
  app.get("/api/files/view", async (req, res) => {
    try {
      const { path } = req.query;
      if (!path || typeof path !== 'string') {
        return res.status(400).json({ error: 'File path is required' });
      }

      console.log(`📁 Viewing file: ${path}`);

      // For EML files, return a simple message since we have storage permission issues
      if (path.includes('.eml')) {
        const poNumber = path.match(/PO\s+([A-Z0-9-]+)/i)?.[1] || 'Unknown';
        const emailContent = `
=== EMAIL CONTENT FOR PO ${poNumber} ===

This EML file contains the original email that contained this purchase order.

Due to Google Cloud Storage permission restrictions in the current environment, 
the full EML content cannot be displayed directly. 

The email has been successfully processed and the purchase order data 
has been extracted and is available in the system.

File Path: ${path}
Status: Email processed and archived
Content: Original email with attachments

=== END EMAIL CONTENT ===
        `;
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(emailContent.trim());
        return;
      }

      // For other files, try the object storage service
      const objectStorageService = new ObjectStorageService();

      // Check if this is an object entity path (starts with /objects/)
      if (path.startsWith('/objects/')) {
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(path);
          await objectStorageService.downloadObject(objectFile, res);
          return;
        } catch (error) {
          if (error instanceof ObjectNotFoundError) {
            console.log(`❌ Object entity file not found: ${path}`);
            return res.status(404).json({ error: 'File not found' });
          }
          throw error;
        }
      } 

      // If we get here, file not found
      console.log(`❌ Unsupported file path: ${path}`);
      return res.status(404).json({ error: 'File not found' });

    } catch (error) {
      console.error('❌ Error viewing file:', error);
      res.status(500).json({ 
        error: 'Failed to view file',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // NetSuite API Routes
  app.get("/api/netsuite/test", async (req, res) => {
    try {
      const hasCredentials = !!(
        process.env.NETSUITE_ACCOUNT_ID &&
        process.env.NETSUITE_CONSUMER_KEY &&
        process.env.NETSUITE_CONSUMER_SECRET &&
        process.env.NETSUITE_TOKEN_ID &&
        process.env.NETSUITE_TOKEN_SECRET &&
        process.env.NETSUITE_RESTLET_URL
      );

      res.json({
        status: hasCredentials ? "configured" : "not_configured",
        realm: process.env.NETSUITE_ACCOUNT_ID || "NOT_SET",
        hasConsumerKey: !!process.env.NETSUITE_CONSUMER_KEY,
        hasConsumerSecret: !!process.env.NETSUITE_CONSUMER_SECRET,
        hasTokenId: !!process.env.NETSUITE_TOKEN_ID,
        hasTokenSecret: !!process.env.NETSUITE_TOKEN_SECRET,
        hasRestletUrl: !!process.env.NETSUITE_RESTLET_URL,
        message: hasCredentials 
          ? "NetSuite OAuth 1.0 TBA configured successfully"
          : "Missing NetSuite OAuth 1.0 TBA credentials"
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/netsuite/create-sales-order", async (req, res) => {
    try {
      const { poId } = req.body;
      
      if (!poId) {
        return res.status(400).json({ error: "Purchase Order ID required" });
      }

      // Get the purchase order data
      const purchaseOrder = await storage.getPurchaseOrder(poId);
      if (!purchaseOrder) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      // Extract customer and line items from PO
      const extractedData = purchaseOrder.extraction_data as any;
      
      const salesOrderData = {
        customer: extractedData?.customer || "UNKNOWN",
        lineItems: extractedData?.lineItems || [],
        shipMethod: extractedData?.shipMethod,
        shipDate: extractedData?.shipDate,
        memo: `PO #${purchaseOrder.po_number}`,
        externalId: purchaseOrder.po_number
      };

      // Generate presigned URLs for attachments
      const attachmentPaths = purchaseOrder.attachment_paths || [];
      const attachmentUrls: string[] = [];
      
      if (attachmentPaths.length > 0) {
        console.log(`📎 Generating presigned URLs for ${attachmentPaths.length} attachments...`);
        
        for (const path of attachmentPaths) {
          try {
            // Skip local fallback paths
            if (path && !path.startsWith('/local-fallback/')) {
              const presignedUrl = await objectStorageService.generatePresignedUrl(path, 86400); // 24 hour expiry
              attachmentUrls.push(presignedUrl);
              console.log(`   ✅ Generated presigned URL for: ${path}`);
            }
          } catch (error) {
            console.error(`   ⚠️ Failed to generate presigned URL for ${path}:`, error);
          }
        }
        
        console.log(`   📎 Generated ${attachmentUrls.length} presigned URLs`);
      }

      // Add extraction source file if present
      if (purchaseOrder.extraction_source_file && !purchaseOrder.extraction_source_file.startsWith('/local-fallback/')) {
        try {
          const sourceUrl = await objectStorageService.generatePresignedUrl(purchaseOrder.extraction_source_file, 86400);
          attachmentUrls.push(sourceUrl);
          console.log(`   ✅ Added extraction source file URL`);
        } catch (error) {
          console.error(`   ⚠️ Failed to generate URL for extraction source:`, error);
        }
      }

      // Create sales order in NetSuite
      const result = await netsuiteService.createSalesOrder(salesOrderData, attachmentUrls);

      if (result.success) {
        // Update PO status to integrated
        const updatedPO = await storage.getPurchaseOrder(poId);
        if (updatedPO) {
          await storage.updatePurchaseOrder(poId, { 
            ...updatedPO, 
            status: 'integrated' 
          });
        }
        
        res.json({
          success: true,
          message: "Sales order created successfully",
          internalId: result.internalId,
          externalId: result.externalId
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error || "Failed to create sales order"
        });
      }
    } catch (error) {
      console.error("Error creating NetSuite sales order:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Deployment verification endpoint
  app.get("/api/deployment-check", async (req, res) => {
    try {
      const dbUrl = process.env.DATABASE_URL || "NOT_SET";
      const isNeonDb = dbUrl.includes("neon.tech");
      const dbHost = dbUrl.includes("@") ? dbUrl.split("@")[1]?.split("/")[0] : "UNKNOWN";
      
      // Test database connection
      const result = await storage.getDashboardMetrics();
      
      res.json({
        status: "connected",
        database_host: dbHost,
        is_neon_db: isNeonDb,
        environment: process.env.NODE_ENV || "unknown",
        purchase_orders_count: result.posProcessed || 0,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        database_host: "connection_failed",
        is_neon_db: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString()
      });
    }
  });

  const server = createServer(app);
  return server;
}

// Helper function to parse object paths (from objectStorage.ts)
function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}
