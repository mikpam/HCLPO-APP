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
      // No new emails, check for pending POs that need customer validation
      console.log(`📋 No new emails found, checking for pending POs...`);
      
      const pendingPOs = await db
        .select()
        .from(purchaseOrdersTable)
        .where(eq(purchaseOrdersTable.status, 'pending'))
        .limit(1);
      
      if (pendingPOs.length > 0) {
        const pendingPO = pendingPOs[0];
        console.log(`🔄 Found pending PO ${pendingPO.poNumber}, starting customer validation...`);
        
        updateProcessingStatus({
          currentStep: "customer_validation",
          currentEmail: `Processing pending PO: ${pendingPO.poNumber}`,
          emailNumber: 1,
          totalEmails: 1
        });
        
        // Process the pending PO through customer validation
        const result = await processPendingPO(pendingPO);
        
        releaseProcessingLock({
          currentStep: "completed",
          currentEmail: `Processed pending PO: ${pendingPO.poNumber}`
        });
        
        return {
          message: `Processed pending PO: ${pendingPO.poNumber}`,
          processed: 1,
          details: result
        };
      }
      
      releaseProcessingLock({
        currentStep: "completed",
        currentEmail: "No new emails or pending POs to process"
      });
      
      return {
        message: "No new emails or pending POs found to process",
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
    
    let queueReservation;
    try {
      queueReservation = await storage.createEmailQueueItem({
        gmailId: messageToProcess.id,
        sender: messageToProcess.sender,
        subject: messageToProcess.subject,
        body: messageToProcess.body,
        attachments: messageToProcess.attachments,
        labels: messageToProcess.labels,
        status: 'processing'
      });
      
      // If we successfully created the queue item, we have the lock
      console.log(`   ✅ Queue lock acquired for Gmail message ${messageToProcess.id}`);
    } catch (queueError) {
      // If we can't create the queue item, it likely already exists (race condition)
      console.log(`   ⚠️ RACE CONDITION DETECTED: Another process is already handling Gmail message ${messageToProcess.id}`);
      
      releaseProcessingLock({
        currentStep: "completed",
        currentEmail: `Race condition detected - email being processed elsewhere`
      });
      
      return {
        message: "Email already being processed by another instance",
        processed: 0,
        details: {
          emailId: messageToProcess.id,
          reason: "race_condition_detected"
        }
      };
    }

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

    const result = await processEmailThroughValidationSystem(messageToProcess, updateProcessingStatus, queueReservation);
    
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
async function processEmailThroughValidationSystem(messageToProcess: any, updateProcessingStatus: Function, queueItem: any) {
  updateProcessingStatus({
    currentStep: "forwarded_email_check",
    currentEmail: `Checking forwarded email: ${messageToProcess.subject}`,
    emailNumber: 1,
    totalEmails: 1
  });

  // Check for forwarded email patterns
  let isForwardedEmail = false;
  let extractedCNumber = null;
  let effectiveSender = messageToProcess.sender;
  let hclCustomerLookup = null;
  
  // Expanded forwarded email detection
  const forwardedSubjectPattern = /^(FW:|Fwd:|RE:\s*FW:|RE:\s*Fwd:)/i;
  const purchaseOrderEmailPattern = /purchaseorder|po-automated|po\.automated|orders@/i;
  const knownForwardingDomains = ['@highcaliberline.com', '@geiger.com'];
  
  const isFromKnownDomain = knownForwardingDomains.some(domain => 
    messageToProcess.sender.toLowerCase().includes(domain)
  );
  const hasForwardedSubject = forwardedSubjectPattern.test(messageToProcess.subject);
  const isPurchaseOrderEmail = purchaseOrderEmailPattern.test(messageToProcess.sender);
  
  // Check multiple forwarded email indicators
  if (isFromKnownDomain || hasForwardedSubject || isPurchaseOrderEmail) {
    console.log(`\n📨 FORWARDED EMAIL DETECTION:`);
    console.log(`   └─ From known domain: ${isFromKnownDomain}`);
    console.log(`   └─ Has forwarded subject: ${hasForwardedSubject}`);
    console.log(`   └─ Is purchase order email: ${isPurchaseOrderEmail}`);
    console.log(`   └─ Sender: ${messageToProcess.sender}`);
    
    isForwardedEmail = true;
    
    // Special handling for HCL emails with CNumber
    if (messageToProcess.sender.includes('@highcaliberline.com')) {
      console.log(`   └─ Checking for CNumber in @highcaliberline.com email...`);
      
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
    
    console.log(`   ✅ Email marked as FORWARDED - will prioritize extracted customer info`);
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
                    status: 'pending_validation', // Updated status - extraction complete, pending validation
                    originalJson: processingResult.classification,
                    extractedData: extractionResult, // Store the complete Gemini extraction
                    lineItems: extractionResult?.lineItems || [],
                    contact: extractionResult?.purchaseOrder?.contact?.name || null,
                    customerMeta: extractionResult?.purchaseOrder?.customer || null,
                    emlFilePath: emlFilePath,
                    extractionSourceFile: extractionSourceFile,
                    attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths.map(att => att.storagePath) : [],
                    processingStartedAt: new Date(), // Track when processing started
                    statusChangedAt: new Date() // Track when status changed
                  });
                  
                  console.log(`   ✅ IMMEDIATE STORAGE COMPLETE: PO ${finalPONumber} created with extraction data`);
                  console.log(`   └─ Database ID: ${purchaseOrder.id}`);
                  console.log(`   └─ Status: pending_validation (extraction complete)`);
                  
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
                customerMeta: extractionResult?.purchaseOrder?.customer || null,
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
            status: 'pending_validation', // Updated status - extraction complete, pending validation
            originalJson: processingResult.classification,
            extractedData: extractionResult, // Store the complete Gemini extraction
            lineItems: extractionResult?.lineItems || [],
            contact: extractionResult?.purchaseOrder?.contact?.name || null,
            customerMeta: extractionResult?.purchaseOrder?.customer || null,
            emlFilePath: emlFilePath,
            extractionSourceFile: extractionSourceFile,
            attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths.map(att => att.storagePath) : [],
            processingStartedAt: new Date(), // Track when processing started
            statusChangedAt: new Date() // Track when status changed
          });
          
          console.log(`   ✅ IMMEDIATE STORAGE COMPLETE: PO ${finalPONumber} created with extraction data`);
          console.log(`   └─ Database ID: ${purchaseOrder.id}`);
          console.log(`   └─ Status: pending_validation (extraction complete)`);
          
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
      
      // If contact has associated customer info and current customer is not found, use it
      if (validatedContact.associated_customer && validatedContact.associated_customer.customer_number) {
        console.log(`   🏢 Contact has associated customer: ${validatedContact.associated_customer.company_name} (${validatedContact.associated_customer.customer_number})`);
      }
      
      // STEP 2 COMPLETION: Update database immediately with contact validation results
      try {
        if (purchaseOrder) {
          await storage.updatePurchaseOrder(purchaseOrder.id, {
            contactMeta: {
              ...contactMeta,
              verified: validatedContact.verified || false
            },
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

    // 🔥 REMOVED DUPLICATE VALIDATION: Using only Hybrid Customer Validator in Step 7
    // This eliminates conflicting validation results between OpenAI Finder and Hybrid Validator
    
    if (isForwardedEmail && extractionResult?.purchaseOrder?.customer) {
      console.log(`\n📋 FORWARDED EMAIL PROCESSING:`);
      console.log(`   └─ Original sender: ${messageToProcess.sender}`);
      console.log(`   └─ CNumber: ${extractedCNumber}`);
      console.log(`   └─ Using customer from Gemini: ${extractionResult.purchaseOrder.customer.company || extractionResult.purchaseOrder.customer.email || 'Unknown'}`);
      
      // For forwarded emails, use the customer info from Gemini extraction
      customerInfo = extractionResult.purchaseOrder.customer;
      effectiveSenderForPO = customerInfo.email || messageToProcess.sender;
    }

    // 🔥 STEP 7: AUTOMATIC CUSTOMER VALIDATION (from SYSTEM_LOGIC_FLOW.md)
    let customerValidationResult: any = null;
    let customerValidated = false;
    if (extractionResult) {
      console.log(`\n🔍 STEP 7: Running automatic customer validation for PO ${poNumber}...`);
      
      updateProcessingStatus({
        currentStep: "customer_validation"
      });

      try {
        const customer = extractionResult?.purchaseOrder?.customer || {};
        
        // Import and create validator instance
        const { HybridCustomerValidator } = await import('./services/hybrid-customer-validator');
        const hybridValidator = new HybridCustomerValidator();
        
        // Prepare input for hybrid validator
        const validationInput = {
          customerName: customer.company || customer.customerName,
          customerEmail: customer.email || effectiveSenderForPO,
          senderEmail: effectiveSenderForPO || undefined,
          customerNumber: customer.customerNumber,
          contactName: customer.contactName,
          address: customer.address
        };
        
        console.log(`   🔍 Customer validation input:`, validationInput);
        
        // Run 4-step hybrid validation (Exact DB → Vector → Rules → LLM)
        customerValidationResult = await hybridValidator.validateCustomer(validationInput);
        
        console.log(`   ✅ Customer validation result:`, customerValidationResult);
        
        // Store validation result for later use when creating PO
        if (customerValidationResult.matched) {
          customerValidated = true;
          customerMeta = {
            method: customerValidationResult.method,
            status: "found",
            resolved: true,
            confidence: customerValidationResult.confidence,
            customer_name: customerValidationResult.customerName,
            customer_number: customerValidationResult.customerNumber
          };
          
          console.log(`   ✅ Customer validation completed: ${customerValidationResult.customerName} (${customerValidationResult.customerNumber})`);
        } else {
          console.log(`   ❌ Customer validation failed: ${customerValidationResult.reasons?.join(', ') || 'Unknown reason'}`);
          
          // Check if contact validation provided associated customer info
          if (contactMeta?.associated_customer?.customer_number) {
            console.log(`   🔄 Using customer info from contact association: ${contactMeta.associated_customer.company_name} (${contactMeta.associated_customer.customer_number})`);
            customerValidated = true;
            customerMeta = {
              method: 'contact_association',
              status: "found",
              resolved: true,
              confidence: 0.85,
              customer_name: contactMeta.associated_customer.company_name,
              customer_number: contactMeta.associated_customer.customer_number
            };
            customerValidationResult = {
              matched: true,
              method: 'contact_association',
              confidence: 0.85,
              customerName: contactMeta.associated_customer.company_name,
              customerNumber: contactMeta.associated_customer.customer_number,
              reasons: ['Customer found via contact association']
            };
          }
        }
        
      } catch (error) {
        console.error(`   ❌ Customer validation error:`, error);
        
        // Check if contact validation provided associated customer info even on error
        if (contactMeta?.associated_customer?.customer_number) {
          console.log(`   🔄 Using customer info from contact association (fallback): ${contactMeta.associated_customer.company_name} (${contactMeta.associated_customer.customer_number})`);
          customerValidated = true;
          customerMeta = {
            method: 'contact_association',
            status: "found",
            resolved: true,
            confidence: 0.85,
            customer_name: contactMeta.associated_customer.company_name,
            customer_number: contactMeta.associated_customer.customer_number
          };
          customerValidationResult = {
            matched: true,
            method: 'contact_association',
            confidence: 0.85,
            customerName: contactMeta.associated_customer.company_name,
            customerNumber: contactMeta.associated_customer.customer_number,
            reasons: ['Customer found via contact association']
          };
        }
      }
    }

    // 🔥 STEP 8: AUTOMATIC CONTACT VALIDATION (from SYSTEM_LOGIC_FLOW.md)
    let contactValidationResult: any = null;
    let contactValidated = false;
    if (extractionResult) {
      console.log(`\n📞 STEP 8: Running automatic contact validation for PO ${poNumber}...`);
      
      updateProcessingStatus({
        currentStep: "contact_validation"
      });

      try {
        const customer = extractionResult?.purchaseOrder?.customer || {};
        const contact = extractionResult?.purchaseOrder?.contact || {};
        
        // Import and create validator instance
        const { OpenAIContactValidatorService } = await import('./services/openai-contact-validator');
        const contactValidator = new OpenAIContactValidatorService();
        
        // Prepare input for contact validator - using the correct interface fields
        const contactInput = {
          extractedData: extractionResult,
          senderName: contact.name || customer.contactName || effectiveSenderForPO?.split('<')[0]?.trim() || '',
          senderEmail: contact.email || customer.email || effectiveSenderForPO || '',
          resolvedCustomerId: customerValidationResult?.customerNumber || customerMeta?.customer_number || '',
          companyId: customerValidationResult?.customerNumber || ''
        };
        
        console.log(`   📞 Contact validation input:`, contactInput);
        
        // Run 4-step contact validation (Exact Email → Vector → Domain+Company → LLM)
        contactValidationResult = await contactValidator.validateContact(contactInput);
        
        console.log(`   ✅ Contact validation result:`, contactValidationResult);
        
        // Store validation result for later use when creating PO
        contactValidated = contactValidationResult.match_method !== 'UNKNOWN' && 
                          contactValidationResult.confidence > 0.5;
        
        // If validation failed but we have extracted contact data, use it as unverified
        const extractedContact = extractionResult?.purchaseOrder?.contact || {};
        const hasExtractedContact = extractedContact.name || extractedContact.email;
        
        const updatedContactMeta = {
          method: contactValidationResult.match_method,
          status: contactValidated ? "found" : (hasExtractedContact ? "unverified" : "not_found"),
          resolved: contactValidated,
          confidence: contactValidationResult.confidence,
          contact_name: contactValidated ? contactValidationResult.name : (extractedContact.name || ''),
          contact_email: contactValidated ? contactValidationResult.email : (extractedContact.email || ''),
          contact_phone: extractedContact.phone || '',
          is_verified: contactValidated,
          source: contactValidated ? 'validated' : 'extracted_unverified'
        };
        
        contactMeta = updatedContactMeta;
        
        if (contactValidated) {
          console.log(`   ✅ Contact validation completed: ${contactValidationResult.name} <${contactValidationResult.email}>`);
          
          // If contact has associated customer info and customer wasn't found earlier, use it
          if (contactValidationResult.associated_customer?.customer_number && !customerValidated) {
            console.log(`   🔄 Updating customer from contact association: ${contactValidationResult.associated_customer.company_name} (${contactValidationResult.associated_customer.customer_number})`);
            customerValidated = true;
            customerMeta = {
              method: 'contact_association',
              status: "found",
              resolved: true,
              confidence: 0.85,
              customer_name: contactValidationResult.associated_customer.company_name,
              customer_number: contactValidationResult.associated_customer.customer_number
            };
            customerValidationResult = {
              matched: true,
              method: 'contact_association',
              confidence: 0.85,
              customerName: contactValidationResult.associated_customer.company_name,
              customerNumber: contactValidationResult.associated_customer.customer_number,
              reasons: ['Customer found via contact association']
            };
          }
        } else {
          console.log(`   ❌ Contact validation failed: ${contactValidationResult.evidence?.join(', ') || 'No valid contact found'}`);
        }
        
      } catch (error) {
        console.error(`   ❌ Contact validation error:`, error);
      }
    }

    // 🔥 STEP 9: SKU/LINE ITEM VALIDATION (from SYSTEM_LOGIC_FLOW.md)
    let validatedLineItems: any[] | null = null;
    let lineItemsValidated = false;
    if (extractionResult?.lineItems?.length > 0) {
      console.log(`\n🔍 STEP 9: Running SKU/Line item validation for PO ${poNumber}...`);
      
      updateProcessingStatus({
        currentStep: "line_item_validation"
      });
      
      console.log(`   └─ Processing ${extractionResult.lineItems.length} line items for validation`);
      
      try {
        // Create fresh validator instance for this email to prevent race conditions with health monitoring
        const skuValidator = await validatorHealthService.recordValidatorCall(
          'skuValidator',
          async () => new OpenAISKUValidatorService()
        );
        validatedLineItems = await skuValidator.validateLineItems(extractionResult.lineItems);
        
        console.log(`   ✅ SKU validation complete: ${validatedLineItems?.length || 0} items processed`);
        lineItemsValidated = true;
        
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
        }
        
      } catch (error) {
        console.error(`   ❌ SKU validation failed:`, error);
        console.log(`   └─ Continuing with original line items`);
        // Continue without validation rather than failing the entire process
      }
    }

    // 🔥 STEP 10: DATABASE STORAGE (from SYSTEM_LOGIC_FLOW.md) - Create complete PO with all validation results
    if (!purchaseOrder) {
      console.log(`\n💾 STEP 10: Creating complete PO record with all validation results for ${poNumber}...`);
      
      purchaseOrder = await storage.createPurchaseOrder({
        poNumber,
        emailId: messageToProcess.id,
        sender: effectiveSenderForPO,
        subject: messageToProcess.subject,
        route: processingResult.classification.recommended_route,
        confidence: processingResult.classification.analysis_flags?.confidence_score || 0,
        status: 'validating', // Will be updated in Step 11
        originalJson: processingResult.classification,
        extractedData: {
          ...extractionResult,
          validatedLineItems: validatedLineItems,
          forwardedEmail: isForwardedEmail ? {
            originalSender: messageToProcess.sender,
            cNumber: extractedCNumber,
            hclCustomerLookup: hclCustomerLookup,
            extractedCustomer: customerInfo || hclCustomerLookup
          } : undefined
        },
        lineItems: extractionResult?.lineItems || [],
        customerMeta: customerMeta,
        contactMeta: contactMeta,
        contact: contactMeta?.contact_name || extractionResult?.purchaseOrder?.contact?.name || null,
        emlFilePath: emlFilePath,
        extractionSourceFile: extractionSourceFile,
        attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths.map(att => att.storagePath) : [],
        // Include validation flags
        customerValidated: customerValidated,
        contactValidated: contactValidated,
        lineItemsValidated: lineItemsValidated
      });
      console.log(`   ✅ Complete PO record created: ${purchaseOrder.id}`);
    } else {
      console.log(`   ⚠️ PO already exists: ${purchaseOrder.id} - updating with validation results`);
      // Update the existing PO with validation results
      await storage.updatePurchaseOrder(purchaseOrder.id, {
        extractedData: {
          ...extractionResult,
          validatedLineItems: validatedLineItems,
          forwardedEmail: isForwardedEmail ? {
            originalSender: messageToProcess.sender,
            cNumber: extractedCNumber,
            hclCustomerLookup: hclCustomerLookup,
            extractedCustomer: customerInfo || hclCustomerLookup
          } : undefined
        },
        lineItems: extractionResult?.lineItems || [],
        customerMeta: customerMeta,
        contactMeta: contactMeta,
        contact: contactMeta?.contact_name || extractionResult?.purchaseOrder?.contact?.name || null,
        emlFilePath: emlFilePath,
        extractionSourceFile: extractionSourceFile,
        attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths.map(att => att.storagePath) : [],
        customerValidated: customerValidated,
        contactValidated: contactValidated,
        lineItemsValidated: lineItemsValidated
      });
    }

    // 🔥 STEP 11: AUTOMATIC STATUS DETERMINATION (from SYSTEM_LOGIC_FLOW.md)
    if (purchaseOrder) {
      console.log(`\n🎯 STEP 11: Determining final status for PO ${purchaseOrder.poNumber}...`);
      
      updateProcessingStatus({
        currentStep: "status_determination"
      });

      let finalStatus = 'pending_review'; // Default fallback
      
      // Get current validation states
      const updatedPO = await storage.getPurchaseOrder(purchaseOrder.id);
      const hasCustomer = updatedPO?.customerValidated || false;
      const hasContact = updatedPO?.contactValidated || false;
      const hasLineItems = updatedPO?.lineItemsValidated || lineItemsValidated;
      
      // Status logic from SYSTEM_LOGIC_FLOW.md Step 11
      if (hasCustomer && hasContact && hasLineItems) {
        finalStatus = 'ready_for_netsuite';
        console.log(`   ✅ Status: ready_for_netsuite (Customer ✓ Contact ✓ Line Items ✓)`);
      } else if (extractionResult && !hasCustomer && hasLineItems) {
        finalStatus = 'new_customer';
        console.log(`   🆕 Status: new_customer (Valid extraction but customer not in database)`);
      } else if (!extractionResult || (!hasCustomer && !hasContact)) {
        finalStatus = 'pending_review';
        console.log(`   ⏳ Status: pending_review (Failed extraction or validation issues)`);
      }
      
      // Update final status and mark validation completed
      await storage.updatePurchaseOrder(purchaseOrder.id, {
        status: finalStatus,
        validationCompleted: true,
        lineItemsValidated: lineItemsValidated // Set based on whether SKU validation ran
      });
      
      console.log(`   🎯 Final status assigned: ${finalStatus}`);
    }
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

// Process pending PO through customer validation
async function processPendingPO(pendingPO: any) {
  try {
    console.log(`🔄 PROCESSING PENDING PO: ${pendingPO.poNumber} (${pendingPO.id})`);
    
    // Update status to show we're processing
    await db
      .update(purchaseOrdersTable)
      .set({
        status: 'validating',
        processingStartedAt: new Date(),
        statusChangedAt: new Date()
      })
      .where(eq(purchaseOrdersTable.id, pendingPO.id));

    // Extract data from the existing PO
    const extractedData = pendingPO.extractedData;
    if (!extractedData) {
      console.log(`   ❌ No extracted data found for PO ${pendingPO.poNumber}`);
      await db
        .update(purchaseOrdersTable)
        .set({
          status: 'extraction_failed',
          lastError: 'No extracted data found',
          statusChangedAt: new Date()
        })
        .where(eq(purchaseOrdersTable.id, pendingPO.id));
      return { success: false, reason: 'No extracted data' };
    }

    // Run customer validation
    console.log(`\n🏢 STEP 7: Running automatic customer validation for pending PO ${pendingPO.poNumber}...`);
    
    const { HybridCustomerValidator } = await import('./services/hybrid-customer-validator');
    const customerValidator = new HybridCustomerValidator();
    
    const customer = extractedData?.purchaseOrder?.customer || extractedData?.customer || {};
    const customerInput = {
      customerName: customer.company || customer.customerName || 'Unknown Customer',
      customerEmail: customer.email || pendingPO.sender || '',
      senderEmail: pendingPO.sender || '',
      senderDomain: (pendingPO.sender || '').split('@')[1] || '',
      contactName: customer.contactName || customer.firstName && customer.lastName ? `${customer.firstName} ${customer.lastName}` : '',
      phoneDigits: customer.phone?.replace(/\D/g, '') || '',
      address: {
        city: customer.city || '',
        state: customer.state || ''
      }
    };

    console.log(`   🏢 Customer validation input:`, customerInput);
    
    const customerValidationResult = await customerValidator.validateCustomer(customerInput);
    console.log(`   ✅ Customer validation result:`, customerValidationResult);

    // Update PO with customer validation results
    let finalStatus = 'pending_review';
    const customerMeta: any = {};
    let hasCustomer = false;
    let hasContact = false;
    let lineItemsValidated = false;

    if (customerValidationResult.matched) {
      customerMeta.customer_number = customerValidationResult.customerNumber;
      customerMeta.customer_name = customerValidationResult.customerName;
      customerMeta.method = customerValidationResult.method;
      customerMeta.confidence = customerValidationResult.confidence;
      hasCustomer = true;
      console.log(`   ✅ Customer found: ${customerValidationResult.customerName} (${customerValidationResult.customerNumber})`);
    } else {
      customerMeta.customer_number = 'NO_CUSTOMER_NUMBER';
      customerMeta.customer_name = 'NO_CUSTOMER_FOUND';
      customerMeta.method = 'none';
      customerMeta.confidence = 0;
      console.log(`   ❌ Customer not found - flagged as new customer`);
    }

    // Update customer metadata first
    await db
      .update(purchaseOrdersTable)
      .set({
        customerMeta: customerMeta,
        customerValidated: customerValidationResult.matched,
        statusChangedAt: new Date()
      })
      .where(eq(purchaseOrdersTable.id, pendingPO.id));

    // Continue with contact validation if customer was found
    if (hasCustomer) {
      console.log(`\n👤 STEP 8: Running contact validation for pending PO ${pendingPO.poNumber}...`);
      
      const { HybridContactValidator } = await import('./services/hybrid-contact-validator');
      const contactValidator = new HybridContactValidator();
      
      const contactInput = {
        contactName: customerInput.contactName,
        contactEmail: customerInput.customerEmail,
        senderEmail: customerInput.senderEmail,
        senderDomain: customerInput.senderDomain,
        companyName: customerValidationResult.customerName,
        customerNumber: customerValidationResult.customerNumber
      };

      console.log(`   👤 Contact validation input:`, contactInput);
      
      const contactValidationResult = await contactValidator.validateContact(contactInput);
      console.log(`   ✅ Contact validation result:`, contactValidationResult);

      if (contactValidationResult.matched_contact_id) {
        hasContact = true;
        
        // Update contact metadata
        const contactMeta = {
          contact_name: contactValidationResult.name,
          contact_email: contactValidationResult.email,
          method: contactValidationResult.match_method,
          confidence: contactValidationResult.confidence
        };

        await db
          .update(purchaseOrdersTable)
          .set({
            contactMeta: contactMeta,
            contactValidated: true,
            statusChangedAt: new Date()
          })
          .where(eq(purchaseOrdersTable.id, pendingPO.id));

        console.log(`   ✅ Contact found: ${contactValidationResult.name}`);
      } else {
        console.log(`   ❌ Contact not found in database`);
      }

      // Run SKU validation if we have line items
      if (extractedData?.lineItems && Array.isArray(extractedData.lineItems) && extractedData.lineItems.length > 0) {
        console.log(`\n📦 STEP 9: Running SKU validation for pending PO ${pendingPO.poNumber}...`);
        console.log(`   📋 Found ${extractedData.lineItems.length} line items to validate`);
        
        const { OpenAISKUValidatorService } = await import('./services/openai-sku-validator');
        const skuValidator = new OpenAISKUValidatorService();
        
        const skuValidationResult = await skuValidator.validateLineItems(extractedData.lineItems);

        console.log(`   ✅ SKU validation completed:`, {
          totalItems: extractedData.lineItems.length,
          validatedItems: skuValidationResult.length,
          processedItems: skuValidationResult
        });

        if (skuValidationResult && skuValidationResult.length > 0) {
          lineItemsValidated = true;
          
          // Update line items with validation results
          await db
            .update(purchaseOrdersTable)
            .set({
              extractedData: {
                ...extractedData,
                lineItems: skuValidationResult
              },
              lineItemsValidated: true,
              statusChangedAt: new Date()
            })
            .where(eq(purchaseOrdersTable.id, pendingPO.id));

          console.log(`   ✅ Line items updated with validation results`);
        } else {
          console.log(`   ❌ SKU validation failed - no valid items returned`);
        }
      } else {
        console.log(`   ⚠️ No line items found for SKU validation`);
      }
    }

    // Determine final status based on all validation results
    if (hasCustomer && hasContact && lineItemsValidated) {
      finalStatus = 'ready_for_import';
      console.log(`   🎯 All validations passed - ready for NetSuite import`);
    } else if (hasCustomer && hasContact) {
      finalStatus = 'sku_validation_needed';
      console.log(`   📦 Customer & contact found, but SKU validation needed`);
    } else if (hasCustomer) {
      finalStatus = 'contact_validation_needed';
      console.log(`   👤 Customer found, but contact validation needed`);
    } else {
      finalStatus = 'new_customer';
      console.log(`   🆕 New customer - requires manual setup`);
    }

    // Update final status
    await db
      .update(purchaseOrdersTable)
      .set({
        status: finalStatus,
        validationCompleted: true,
        statusChangedAt: new Date(),
        processingStartedAt: null
      })
      .where(eq(purchaseOrdersTable.id, pendingPO.id));

    console.log(`   🎯 Pending PO processed - Final status: ${finalStatus}`);
    
    return {
      success: true,
      poNumber: pendingPO.poNumber,
      finalStatus,
      customerFound: customerValidationResult.matched,
      customerName: customerValidationResult.customerName,
      customerNumber: customerValidationResult.customerNumber
    };

  } catch (error) {
    console.error(`❌ Error processing pending PO ${pendingPO.poNumber}:`, error);
    
    // Update PO with error status
    await db
      .update(purchaseOrdersTable)
      .set({
        status: 'validation_failed',
        lastError: error instanceof Error ? error.message : 'Unknown error',
        statusChangedAt: new Date(),
        processingStartedAt: null
      })
      .where(eq(purchaseOrdersTable.id, pendingPO.id));

    return {
      success: false,
      poNumber: pendingPO.poNumber,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
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
      
      // Track if polling is in progress to prevent overlapping runs
      let isPollingInProgress = false;
      let pollingCycleCount = 0;
      
      // Import stuck process recovery service
      const { checkAndRecoverStuckProcesses, getDeadLetterStats } = await import('./services/stuck-process-recovery');
      
      // Create a simple polling function that checks for new emails every minute
      const pollEmails = async () => {
        // Skip if previous polling is still running
        if (isPollingInProgress) {
          console.log('📧 Auto-polling: Previous polling still in progress - skipping this cycle');
          return;
        }
        
        isPollingInProgress = true;
        pollingCycleCount++;
        
        try {
          // Run stuck process recovery every 5 cycles (5 minutes)
          if (pollingCycleCount % 5 === 0) {
            try {
              const recoveryResult = await checkAndRecoverStuckProcesses();
              if (recoveryResult.recovered > 0 || recoveryResult.deadLettered > 0) {
                console.log(`🔧 STUCK PROCESS RECOVERY: Recovered ${recoveryResult.recovered} POs, dead-lettered ${recoveryResult.deadLettered}`);
                
                // Log dead letter stats if any were moved
                if (recoveryResult.deadLettered > 0) {
                  const deadLetterStats = await getDeadLetterStats();
                  console.log(`   └─ Dead letter queue: ${deadLetterStats.total} total POs requiring manual review`);
                }
              }
            } catch (error) {
              console.error('❌ Stuck process recovery error:', error);
            }
          }
          
          console.log('📧 Auto-polling: Checking for new emails...');
          
          // Try to acquire processing lock for automated processing
          const lockAcquired = tryAcquireProcessingLock({
            currentStep: "auto_polling",
            currentEmail: "Checking for new emails via auto-polling...",
            emailNumber: 0,
            totalEmails: 0
          });

          if (!lockAcquired) {
            console.log('📧 Auto-polling: System busy processing - will try again in 30 seconds');
            isPollingInProgress = false;
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
            console.log('📧 Auto-polling error:', (error as Error).message);
            releaseProcessingLock({
              currentStep: "error",
              currentEmail: `Auto-polling error: ${(error as Error).message}`
            });
          } finally {
            isPollingInProgress = false;
          }
        } catch (error) {
          console.log('📧 Auto-polling: System error or no new emails');
          isPollingInProgress = false;
        }
      };
      
      // Enable automatic polling every 30 seconds (reduced from 1 minute for faster processing)
      setInterval(pollEmails, 30000);
      console.log('📧 Automatic polling enabled - checking every 30 seconds');
      
    } catch (error) {
      console.error('❌ Failed to start email polling:', error);
      console.log('📝 Fallback: Use manual API endpoints for processing');
    }
  }, 2000);
  

  
  // Reset stuck emails endpoint
  app.post("/api/reset-stuck-emails", async (req, res) => {
    try {
      console.log('🔧 RESET STUCK EMAILS: Finding emails stuck in processing status...');
      
      // Find all emails stuck in processing status
      const stuckEmails = await storage.getEmailQueue({ status: 'processing' });
      
      if (stuckEmails.length === 0) {
        return res.json({
          message: "No stuck emails found",
          reset: 0
        });
      }
      
      console.log(`🔧 RESET STUCK EMAILS: Found ${stuckEmails.length} emails stuck in processing status`);
      
      let resetCount = 0;
      for (const email of stuckEmails) {
        try {
          await storage.updateEmailQueueItem(email.id, {
            status: 'pending',
            processedAt: null,
            preprocessingResult: null,
            classificationResult: null,
            route: null,
            confidence: null
          });
          resetCount++;
          console.log(`   ✅ Reset email: ${email.subject}`);
        } catch (error) {
          console.log(`   ❌ Failed to reset email ${email.id}:`, (error as Error).message);
        }
      }
      
      console.log(`🔧 RESET STUCK EMAILS: Successfully reset ${resetCount} emails`);
      
      res.json({
        message: `Successfully reset ${resetCount} stuck emails`,
        reset: resetCount,
        found: stuckEmails.length
      });
      
    } catch (error) {
      console.error('❌ Failed to reset stuck emails:', error);
      res.status(500).json({ error: "Failed to reset stuck emails" });
    }
  });

  // 🚫 MANUAL VALIDATION ENDPOINTS REMOVED 
  // All validation now happens automatically during email processing
  // Following SYSTEM_LOGIC_FLOW.md - Steps 7-8 integrated into auto pipeline


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

  // Dead Letter Queue Management Endpoints
  app.get("/api/processing/dead-letter-stats", async (req, res) => {
    try {
      const { getDeadLetterStats } = await import('./services/stuck-process-recovery');
      const stats = await getDeadLetterStats();
      res.json(stats);
    } catch (error) {
      console.error('Failed to get dead letter stats:', error);
      res.status(500).json({ 
        error: 'Failed to get dead letter statistics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/processing/retry-dead-letter/:poId", async (req, res) => {
    try {
      const { poId } = req.params;
      const { retryDeadLetterPO } = await import('./services/stuck-process-recovery');
      const result = await retryDeadLetterPO(poId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error('Failed to retry dead letter PO:', error);
      res.status(500).json({ 
        success: false,
        message: 'Failed to retry purchase order'
      });
    }
  });

  app.post("/api/processing/check-stuck-processes", async (req, res) => {
    try {
      const { checkAndRecoverStuckProcesses } = await import('./services/stuck-process-recovery');
      const result = await checkAndRecoverStuckProcesses();
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('Failed to check stuck processes:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to check stuck processes',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/processing/daily-report", async (req, res) => {
    try {
      const { generateDailyReport } = await import('./services/stuck-process-recovery');
      const report = await generateDailyReport();
      res.json(report);
    } catch (error) {
      console.error('Failed to generate daily report:', error);
      res.status(500).json({ 
        error: 'Failed to generate daily report',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
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
        customerMeta: extractedData.purchaseOrder?.customer || targetPO.customerMeta,
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
          customerMeta: extractedData.purchaseOrder?.customer || null
        }
      });
      
    } catch (error) {
      console.error('❌ Error fixing extraction data:', error);
      res.status(500).json({ 
        error: 'Failed to fix extraction data',
        details: (error as Error).message 
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
      const extractedData = purchaseOrder.extractedData as any;
      
      const salesOrderData = {
        customer: extractedData?.customer || "UNKNOWN",
        lineItems: extractedData?.lineItems || [],
        shipMethod: extractedData?.shipMethod,
        shipDate: extractedData?.shipDate,
        memo: `PO #${purchaseOrder.poNumber}`,
        externalId: purchaseOrder.poNumber
      };

      // Generate presigned URLs for attachments
      const attachmentPaths = purchaseOrder.attachmentPaths || [];
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
      if (purchaseOrder.extractionSourceFile && !purchaseOrder.extractionSourceFile.startsWith('/local-fallback/')) {
        try {
          const sourceUrl = await objectStorageService.generatePresignedUrl(purchaseOrder.extractionSourceFile, 86400);
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

  // Documentation route for AI agents
  app.get('/docs/agents', async (req: any, res: any) => {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const agentsDocPath = path.join(process.cwd(), 'agents.md');
    const agentsContent = await fs.readFile(agentsDocPath, 'utf-8');
    
    // Convert markdown to HTML for better display
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Agents Documentation - HCL Procurement Platform</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f8f9fa;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #2563eb; border-bottom: 3px solid #2563eb; padding-bottom: 10px; }
        h2 { color: #1e40af; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-top: 30px; }
        h3 { color: #1e3a8a; margin-top: 25px; }
        h4 { color: #1e40af; }
        code {
            background: #f1f5f9;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.9em;
        }
        pre {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 15px;
            overflow-x: auto;
        }
        .back-link {
            display: inline-block;
            margin-bottom: 20px;
            color: #2563eb;
            text-decoration: none;
            font-weight: 500;
        }
        .back-link:hover { text-decoration: underline; }
        .highlight { background: #fef3c7; padding: 10px; border-radius: 4px; margin: 10px 0; }
        ul, ol { margin: 10px 0; padding-left: 20px; }
        li { margin: 5px 0; }
        strong { color: #1e40af; }
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back to Dashboard</a>
        <div id="content"></div>
    </div>
    
    <script>
        // Simple markdown-to-HTML converter
        const content = \`${agentsContent.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
        
        let html = content
            // Headers
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            // Bold
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Code blocks
            .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
            // Inline code
            .replace(/\`([^\`]*?)\`/g, '<code>$1</code>')
            // Lists
            .replace(/^- (.*$)/gim, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
            // Line breaks
            .replace(/\\n\\n/g, '</p><p>')
            .replace(/^(?!<[hul])/gm, '<p>')
            .replace(/(?<![>])$/gm, '</p>')
            // Clean up
            .replace(/<p><\/p>/g, '')
            .replace(/<p>(<[hul])/g, '$1')
            .replace(/(<\/[hul][^>]*>)<\/p>/g, '$1');
            
        document.getElementById('content').innerHTML = html;
    </script>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
  } catch (error) {
    console.error('Error serving agents documentation:', error);
    res.status(500).json({ error: 'Failed to load documentation' });
  }
});

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

  const server = createServer(app);
  return server;
}
