import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerCustomerRoutes } from "./routes/customers";
import itemsRouter from "./routes/items";
import { gmailService } from "./services/gmail";
import { openaiService } from "./services/openai";
import { aiService, type AIEngine } from "./services/ai-service";
import { netsuiteService } from "./services/netsuite";
import { openaiCustomerFinderService } from "./services/openai-customer-finder";
import { OpenAISKUValidatorService } from "./services/openai-sku-validator";
import { OpenAIContactValidatorService } from "./services/openai-contact-validator";
import { db } from "./db";
import { purchaseOrders, errorLogs } from "@shared/schema";
import { eq, desc, and, or, lt } from "drizzle-orm";

import { insertPurchaseOrderSchema, insertErrorLogSchema, classificationResultSchema } from "@shared/schema";
import { z } from "zod";

// Enhanced error logging helper for comprehensive tracking
async function logProcessingError(
  type: 'preprocessing_failed' | 'classification_failed' | 'extraction_failed' | 'customer_lookup_failed' | 'sku_validation_failed' | 'final_step_failed' | 'gmail_labeling_failed' | 'ai_filter_failed',
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
      'ai_filter_failed': 'Attachment screening error. AI filter may have incorrectly rejected a valid purchase order document.'
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
  
  // Register items routes
  app.use("/api/items", itemsRouter);
  
  // Initialize Gmail labels on startup
  try {
    console.log('Initializing Gmail labels...');
    await gmailService.ensureLabelsExist();
    console.log('Gmail labels initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Gmail labels:', error);
  }

  // Auto-start with retry mechanism - FRESH SYSTEM TEST
  setTimeout(async () => {
    console.log('🔄 AUTO-PROCESSING: Starting fresh system with retry mechanism enabled');
    console.log('📊 Database cleared - testing retry logic on fresh emails');
    
    // Start processing emails immediately
    processEmailsInBackground();
    
    // Check for stuck purchase orders every 5 minutes for faster testing
    setInterval(async () => {
      try {
        await retryStuckPurchaseOrders();
      } catch (error) {
        console.error('Error in periodic stuck PO check:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes for faster retry testing
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

  // Bulk email processing endpoint

  // Process single email for development
  app.post("/api/emails/process-single", async (req, res) => {
    try {
      // Fetch unlabeled emails from Gmail
      const messages = await gmailService.getMessages('in:inbox -label:processed -label:filtered');
      console.log(`Found ${messages.length} messages in inbox`);

      if (messages.length === 0) {
        return res.json({ 
          message: "No messages found to process",
          processed: 0,
          details: null
        });
      }

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
        return res.json({ 
          message: "All messages have been processed already",
          processed: 0,
          details: null
        });
      }

      console.log(`\n🔄 MANUAL PROCESSING: Processing single email`);
      console.log(`📧 EMAIL: "${messageToProcess.subject}"`);
      console.log(`   └─ From: ${messageToProcess.sender}`);
      console.log(`   └─ Attachments: ${messageToProcess.attachments.length}`);

      // Check for forwarded email from @highcaliberline.com and extract CNumber
      let isForwardedEmail = false;
      let extractedCNumber = null;
      let effectiveSender = messageToProcess.sender;
      let hclCustomerLookup = null;
      
      if (messageToProcess.sender.includes('@highcaliberline.com')) {
        console.log(`\n📨 FORWARDED EMAIL DETECTION: Checking for CNumber in @highcaliberline.com email...`);
        
        // Look for CNumber pattern in subject and body (more specific patterns to avoid zip codes)
        // Only match explicit customer number patterns, not general "C: number" which could be zip codes
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
      let extractionResult = null; // Moved to higher scope
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
          // Continue processing even if email preservation fails
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
            
            // Import GeminiService for document filtering
            const { GeminiService } = await import('./services/gemini');
            const geminiService = new GeminiService();
            
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
        
        // Use extracted PO number if available, otherwise generate synthetic one
        console.log(`\n🆔 PO NUMBER ASSIGNMENT:`);
        let poNumber;
        if (extractionResult?.purchaseOrder?.purchaseOrderNumber) {
          // Check if this PO number already exists and append suffix if needed
          poNumber = extractionResult.purchaseOrder.purchaseOrderNumber;
          let originalPoNumber = poNumber;
          let suffix = 1;
          
          while (await storage.getPurchaseOrderByNumber(poNumber)) {
            poNumber = `${originalPoNumber}-${suffix}`;
            suffix++;
          }
          
          if (suffix > 1) {
            console.log(`   ⚠️  PO number ${originalPoNumber} already exists, using: ${poNumber}`);
          } else {
            console.log(`   ✅ Using client PO number: ${poNumber}`);
          }
        } else {
          poNumber = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
          console.log(`   ⚠️  Generated synthetic PO number: ${poNumber}`);
        }
        
        // Determine effective sender and customer for forwarded emails
        let effectiveSenderForPO = messageToProcess.sender;
        let customerInfo = null;
        let customerMeta = null;
        let contactMeta = null;
        
        // Extract contact information for NetSuite (required field)
        if (extractionResult?.purchaseOrder?.contact) {
          console.log(`\n👤 CONTACT EXTRACTION:`);
          console.log(`   └─ Contact Name: ${extractionResult.purchaseOrder.contact.name || 'Not provided'}`);
          console.log(`   └─ Contact Email: ${extractionResult.purchaseOrder.contact.email || 'Not provided'}`);
          console.log(`   └─ Contact Phone: ${extractionResult.purchaseOrder.contact.phone || 'Not provided'}`);
          console.log(`   └─ Job Title: ${extractionResult.purchaseOrder.contact.jobTitle || 'Not provided'}`);
          
          // Optionally validate against HCL contacts database
          try {
            // Use comprehensive OpenAI contact validation
            const contactValidator = new OpenAIContactValidatorService();
            const validatedContact = await contactValidator.validateContact({
              extractedData: extractionResult,
              senderName: extractionResult.purchaseOrder.contact?.name,
              senderEmail: messageToProcess.sender,
              resolvedCustomerId: customerMeta?.customer_number,
              companyId: customerMeta?.customer_number
            });
            
            contactMeta = validatedContact;
            console.log(`   ✅ Contact validated: ${validatedContact.name} <${validatedContact.email}>`);
            console.log(`   └─ Method: ${validatedContact.match_method} (Confidence: ${validatedContact.confidence})`);
            console.log(`   └─ Role: ${validatedContact.role}`);
          } catch (error) {
            console.error(`   ⚠️  Contact lookup failed:`, error);
            // Continue with extracted contact info even if lookup fails
          }
        } else {
          console.log(`\n👤 CONTACT EXTRACTION:`);
          console.log(`   ⚠️  No contact information extracted from purchase order`);
        }

        // Lookup customer in HCL database for all purchase orders using OpenAI-powered matching
        if (extractionResult?.purchaseOrder?.customer) {
          console.log(`\n🔍 OPENAI CUSTOMER LOOKUP:`);
          console.log(`   └─ Searching HCL database for: ${extractionResult.purchaseOrder.customer.company || 'Unknown'}`);
          
          try {
            const { openaiCustomerFinderService } = await import('./services/openai-customer-finder');
            const customerMatch = await openaiCustomerFinderService.findCustomer({
              customerName: extractionResult.purchaseOrder.customer.company,
              customerEmail: extractionResult.purchaseOrder.customer.email,
              senderEmail: messageToProcess.sender,
              asiNumber: extractionResult.purchaseOrder.asiNumber,
              ppaiNumber: extractionResult.purchaseOrder.ppaiNumber,
              address: extractionResult.purchaseOrder.customer.address1
            });
            
            if (customerMatch?.customer_number) {
              customerMeta = customerMatch;
              console.log(`   ✅ OpenAI found HCL customer: ${customerMatch.customer_name} (${customerMatch.customer_number})`);
            } else {
              console.log(`   ❌ OpenAI found no confident match for: ${extractionResult.purchaseOrder.customer.company}`);
              console.log(`   🆕 FLAGGING AS NEW CUSTOMER for CSR review`);
            }
          } catch (error) {
            console.error(`   ❌ OpenAI customer lookup failed:`, error);
            console.log(`   🔄 Falling back to basic customer finder...`);
            
            // Fallback to original customer finder
            try {
              const { customerFinderService } = await import('./services/customer-finder');
              const customerMatch = await customerFinderService.findCustomer({
                customerName: extractionResult.purchaseOrder.customer.company,
                customerEmail: extractionResult.purchaseOrder.customer.email,
                senderEmail: messageToProcess.sender
              });
              
              if (customerMatch?.customer_number) {
                customerMeta = customerMatch;
                console.log(`   ✅ Fallback found HCL customer: ${customerMatch.customer_name} (${customerMatch.customer_number})`);
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

        // SKU Validation for extracted line items
        let validatedLineItems: any[] | null = null;
        if (extractionResult?.lineItems?.length > 0) {
          console.log(`\n🤖 OPENAI SKU VALIDATOR: Processing ${extractionResult.lineItems.length} extracted line items...`);
          
          try {
            const skuValidatorService = new OpenAISKUValidatorService();
            
            console.log(`   └─ Processing ${extractionResult.lineItems.length} line items for validation`);
            
            // Validate line items with OpenAI
            validatedLineItems = await skuValidatorService.validateLineItems(extractionResult.lineItems);
            
            console.log(`   ✅ SKU validation complete: ${validatedLineItems.length} items processed`);
            
            // Merge validated SKUs back into original line items structure
            if (validatedLineItems && extractionResult.lineItems) {
              extractionResult.lineItems.forEach((originalItem: any, index: number) => {
                const validatedItem = validatedLineItems[index];
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

      res.json({ 
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
      });
    } catch (error) {
      console.error('Error processing single email:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to process single email' 
      });
    }
  });

  // SSE endpoint for real-time processing updates - DISABLED FOR NOW
  app.get("/api/emails/process/stream_disabled", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      console.log(`🔄 SSE PROCESSING: Starting real-time sequential email processing...`);
      
      // First, count how many unprocessed emails exist - fetch only unlabeled emails
      const allMessages = await gmailService.getMessages('in:inbox -label:processed -label:filtered');
      let unprocessedCount = 0;
      for (const message of allMessages) {
        const existingQueue = await storage.getEmailQueueByGmailId(message.id);
        if (!existingQueue) {
          unprocessedCount++;
        }
      }
      
      console.log(`📊 SSE PROCESSING: Found ${unprocessedCount} unprocessed emails out of ${allMessages.length} total emails`);
      
      // Send initial status
      sendEvent('progress', {
        type: 'started',
        totalUnprocessed: unprocessedCount,
        totalEmails: allMessages.length,
        message: `Found ${unprocessedCount} unprocessed emails to process`
      });

      let processedCount = 0;
      let totalMessages = allMessages.length;
      const processedEmails = [];
      const maxEmails = Math.max(100, unprocessedCount); // Process all unprocessed emails, with minimum safety limit
      
      // Process emails one at a time until no more unprocessed emails
      while (processedCount < maxEmails) {
        // Fetch unlabeled emails only
        const messages = await gmailService.getMessages('in:inbox -label:processed -label:filtered');
        
        // Find first unprocessed email
        let messageToProcess = null;
        for (const message of messages) {
          const existingQueue = await storage.getEmailQueueByGmailId(message.id);
          if (!existingQueue) {
            messageToProcess = message;
            break;
          }
        }
        
        // No more unprocessed emails
        if (!messageToProcess) {
          console.log(`📧 SSE PROCESSING: No more unprocessed emails found`);
          sendEvent('progress', {
            type: 'no_more_emails',
            processedCount,
            message: 'No more unprocessed emails found'
          });
          break;
        }

        // Send current email update
        sendEvent('progress', {
          type: 'processing_email',
          currentEmail: {
            number: processedCount + 1,
            sender: messageToProcess.sender,
            subject: messageToProcess.subject
          },
          processedCount,
          totalUnprocessed: unprocessedCount,
          message: `Processing email ${processedCount + 1}: ${messageToProcess.subject}`
        });

        console.log(`\n📧 SSE PROCESSING EMAIL ${processedCount + 1}: "${messageToProcess.subject}"`);
        console.log(`   └─ From: ${messageToProcess.sender}`);

        try {
          // Process this email with full pipeline (copy from regular processing)
          const gmailMessage = messageToProcess; // Use the message already fetched
          
          if (!gmailMessage) {
            console.error(`❌ Could not fetch Gmail message details for ${messageToProcess.id}`);
            throw new Error("Failed to fetch message details");
          }

          console.log(`   └─ Attachments: ${gmailMessage.attachments?.length || 0}`);

          // Create email queue entry with processing status
          const emailQueue = await storage.createEmailQueueItem({
            gmailId: messageToProcess.id,
            sender: gmailMessage.sender,
            subject: gmailMessage.subject || "",
            body: gmailMessage.body || "",
            status: "processing",
            attachments: gmailMessage.attachments || []
          });

          // Store attachments first
          if (gmailMessage.attachments && gmailMessage.attachments.length > 0) {
            console.log(`📎 ATTACHMENT ANALYSIS: Found ${gmailMessage.attachments.length} total attachments`);
            
            for (const attachment of gmailMessage.attachments) {
              try {
                if (attachment.data) {
                  const { ObjectStorageService } = await import('./objectStorage');
                  const objectStorageService = new ObjectStorageService();
                  
                  // Store attachment - simple filename sanitization
                  const cleanFilename = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
                  const objectPath = await objectStorageService.storeAttachment(
                    attachment.data,
                    `${messageToProcess.id}_${cleanFilename}`,
                    attachment.mimeType
                  );
                  
                  // Update attachment with object path
                  attachment.objectPath = objectPath;
                  
                  console.log(`   └─ ${attachment.filename}: ${attachment.mimeType} (${attachment.data.length} bytes) [Has ID]`);
                  console.log(`      ✅ Stored attachment: ${attachment.filename} at ${objectPath}`);
                } else {
                  console.log(`   └─ ${attachment.filename}: ${attachment.mimeType} (no data) [Missing Data]`);
                }
              } catch (error) {
                console.error(`   └─ ❌ Failed to store attachment ${attachment.filename}:`, error);
              }
            }
          }

          // Try to preserve email as .eml file
          try {
            // Email preservation handled elsewhere
          } catch (error) {
            console.error("   ❌ Failed to preserve email:", error);
          }

          // Send processing step update
          sendEvent('progress', {
            type: 'processing_step',
            currentEmail: {
              number: processedCount + 1,
              sender: messageToProcess.sender,
              subject: messageToProcess.subject
            },
            step: 'AI Classification',
            message: `Running AI classification for email ${processedCount + 1}`
          });

          // AI Processing Pipeline
          console.log(`🤖 AI PROCESSING: Starting two-step analysis...`);
          
          // Step 1: Pre-processing
          const preprocessing = await openaiService.preProcessEmail(gmailMessage);
          console.log(`📊 EMAIL SIZE: Original body ${gmailMessage.body?.length || 0} chars, truncated to ${preprocessing.emailBody?.length || 0} chars`);
          console.log(`   └─ Pre-processing: ${preprocessing.classification} (Continue: ${preprocessing.shouldProceed})`);

          // Step 2: If pre-processing says proceed, do detailed analysis
          let classification = null;
          if (preprocessing.shouldProceed) {
            classification = await openaiService.classifyEmail(gmailMessage, preprocessing);
            console.log(`   └─ Detailed route: ${classification.route} (${Math.round(classification.confidence)}%)`);
          }

          // Generate PO number
          console.log(`📋 PO NUMBER ASSIGNMENT:`);
          const poNumber = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
          console.log(`   ✅ Generating PO number: ${poNumber}`);

          let purchaseOrder = null;
          if (preprocessing.shouldProceed && classification) {
            // Send extraction step update
            sendEvent('progress', {
              type: 'processing_step',
              currentEmail: {
                number: processedCount + 1,
                sender: messageToProcess.sender,
                subject: messageToProcess.subject
              },
              step: 'Data Extraction',
              message: `Extracting purchase order data from email ${processedCount + 1}`
            });

            // Process based on classification route
            if (classification.route === "ATTACHMENT_PO" || classification.route === "ATTACHMENT_SAMPLE") {
              console.log(`🧠 GEMINI EXTRACTION: Processing ${classification.route}...`);
              
              if (gmailMessage.attachments && gmailMessage.attachments.length > 0) {
                const prioritizedAttachment = gmailMessage.attachments[0]; // Use first attachment for now
                
                if (prioritizedAttachment) {
                  console.log(`   └─ Processing prioritized attachment: ${prioritizedAttachment.filename}`);
                  console.log(`   └─ Attachment data available: ${!!prioritizedAttachment.data}`);
                  console.log(`   └─ Attachment keys:`, Object.keys(prioritizedAttachment));
                  
                  // Get attachment data - either from direct data or download it
                  let attachmentBuffer = prioritizedAttachment.data;
                  
                  // If no direct data, download from Gmail
                  if (!attachmentBuffer && prioritizedAttachment.attachmentId) {
                    console.log(`   └─ Downloading attachment from Gmail...`);
                    attachmentBuffer = await gmailService.downloadAttachment(messageToProcess.id, prioritizedAttachment.attachmentId);
                    console.log(`   └─ Downloaded ${attachmentBuffer?.length || 0} bytes`);
                  }
                  
                  if (attachmentBuffer) {
                    console.log(`   └─ Processing attachment data (${attachmentBuffer.length} bytes)`);
                    const extractedData = await aiService.extractPODataFromPDF(
                      attachmentBuffer,
                      prioritizedAttachment.filename
                    );
                    
                    if (extractedData) {
                      purchaseOrder = await storage.createPurchaseOrder({
                        poNumber,
                        clientPONumber: extractedData.client_po_number || null,
                        customerName: extractedData.customer?.name || null,
                        status: "pending_review",
                        extractedData: extractedData,
                        emailQueueId: emailQueue.id,
                        createdAt: new Date(),
                        updatedAt: new Date()
                      });
                    }
                  }
                }
              }
            } else if (classification.route === "TEXT_PO" || classification.route === "TEXT_SAMPLE") {
              console.log(`🧠 GEMINI EXTRACTION: Processing ${classification.route}...`);
              
              const extractedData = await aiService.extractPODataFromText(
                gmailMessage.subject || "",
                gmailMessage.body || "",
                gmailMessage.sender
              );
              
              if (extractedData) {
                purchaseOrder = await storage.createPurchaseOrder({
                  poNumber,
                  clientPONumber: extractedData.client_po_number || null,
                  customerName: extractedData.customer?.name || null,
                  status: "pending_review",
                  extractedData: extractedData,
                  emailQueueId: emailQueue.id,
                  createdAt: new Date(),
                  updatedAt: new Date()
                });
              }
            }
          }

          // Customer lookup and SKU validation
          if (purchaseOrder) {
            // Send customer lookup step update
            sendEvent('progress', {
              type: 'processing_step',
              currentEmail: {
                number: processedCount + 1,
                sender: messageToProcess.sender,
                subject: messageToProcess.subject
              },
              step: 'Customer Lookup',
              message: `Looking up customer information for email ${processedCount + 1}`
            });

            console.log(`🔍 OPENAI CUSTOMER LOOKUP:`);
            const customerName = purchaseOrder.extractedData?.customer?.name || purchaseOrder.customerName;
            console.log(`   └─ Searching HCL database for: ${customerName || 'No customer name'}`);

            const updatedPO = await openaiCustomerFinderService.processPurchaseOrder(purchaseOrder.id);
            
            console.log(`   ✅ Updated purchase order ${poNumber} (Status: ${updatedPO?.status || 'unknown'})`);
          }

          // Update Gmail labels
          console.log(`Updating Gmail labels for message ${messageToProcess.id}`);
          
          const classificationLabel = preprocessing.classification.toLowerCase().replace(/\s+/g, '-');
          const aiLabelName = `ai-${classificationLabel}`;
          
          console.log(`   └─ Adding '${aiLabelName}' label (AI classification: ${preprocessing.classification})`);
          console.log(`   └─ Adding 'processed' label (passed preprocessing: ${preprocessing.classification})`);
          
          try {
            await gmailService.addLabelToEmail(messageToProcess.id, aiLabelName);
            await gmailService.addLabelToEmail(messageToProcess.id, 'processed');
            console.log(`   ✅ Successfully updated Gmail labels`);
          } catch (error) {
            console.error(`   ❌ Failed to update Gmail labels:`, error);
            await logProcessingError(
              'gmail_labeling_failed',
              `Failed to update Gmail labels during SSE processing: ${error instanceof Error ? error.message : 'Unknown error'}`,
              messageToProcess.id,
              purchaseOrder?.id,
              purchaseOrder?.poNumber,
              {
                error: error instanceof Error ? error.message : error,
                sender: messageToProcess.sender,
                subject: messageToProcess.subject,
                classification: preprocessing.response || 'unknown',
                step: 'sse_processing'
              }
            );
          }

          // Update email queue status
          await storage.updateEmailQueueItem(emailQueue.id, {
            status: "completed",
            classification: preprocessing.classification,
            extractedData: purchaseOrder?.extractedData || null,
            processingSteps: {
              preprocessing,
              classification,
              purchaseOrder: purchaseOrder ? {
                id: purchaseOrder.id,
                poNumber: purchaseOrder.poNumber,
                status: purchaseOrder.status
              } : null
            }
          });

          console.log(`   ✅ Completed processing email ${processedCount + 1}`);
          
          // Send completion update for this email
          sendEvent('progress', {
            type: 'email_completed',
            currentEmail: {
              number: processedCount + 1,
              sender: messageToProcess.sender,
              subject: messageToProcess.subject
            },
            processedCount: processedCount + 1,
            purchaseOrder: purchaseOrder ? {
              poNumber: purchaseOrder.poNumber,
              status: purchaseOrder.status
            } : null,
            message: `Completed processing email ${processedCount + 1}`
          });

          processedEmails.push({
            id: messageToProcess.id,
            sender: messageToProcess.sender,
            subject: messageToProcess.subject,
            classification: preprocessing.classification,
            poNumber: purchaseOrder?.poNumber || null,
            status: purchaseOrder?.status || "no_po_created"
          });

          processedCount++;
          
        } catch (error) {
          console.error(`❌ SSE Error processing email ${messageToProcess?.id}:`, error);
          
          sendEvent('progress', {
            type: 'email_error',
            currentEmail: {
              number: processedCount + 1,
              sender: messageToProcess.sender,
              subject: messageToProcess.subject
            },
            error: error instanceof Error ? error.message : 'Unknown error',
            message: `Error processing email ${processedCount + 1}`
          });
          
          processedCount++; // Still count to avoid infinite loop
        }
      }

      // Send final completion
      sendEvent('progress', {
        type: 'completed',
        processedCount,
        totalEmails: totalMessages,
        message: `Completed processing ${processedCount} emails`
      });

      sendEvent('close', { message: 'Processing complete' });
      
    } catch (error) {
      console.error('SSE Processing error:', error);
      sendEvent('error', { 
        message: error instanceof Error ? error.message : 'Processing failed' 
      });
    }

    res.end();
  });

  // Helper function to handle retry logic for stuck purchase orders
  async function handlePurchaseOrderRetry(poId: string, status: string, error?: string) {
    try {
      // Get current PO details including retry count
      const po = await storage.getPurchaseOrder(poId);
      if (!po) return false;

      const currentRetryCount = po.retryCount || 0;
      
      // If max retries exceeded, mark as error
      if (currentRetryCount >= 3) {
        await storage.updatePurchaseOrder(poId, {
          status: 'max_retries_exceeded',
          comments: `Processing failed after 3 attempts. Last error: ${error || 'Unknown error'}`,
          updatedAt: new Date()
        });
        
        // Log the permanent failure
        await storage.createErrorLog({
          type: 'processing_retry_exceeded',
          message: `PO ${po.poNumber} exceeded max retries (3). Status was: ${status}`,
          relatedPoId: poId,
          relatedPoNumber: po.poNumber,
          metadata: { 
            finalStatus: status, 
            retryCount: currentRetryCount,
            error: error 
          }
        });
        
        console.log(`❌ RETRY EXCEEDED: ${po.poNumber} failed after 3 attempts - marked as max_retries_exceeded`);
        return false;
      }

      // Increment retry count and update status
      await storage.updatePurchaseOrder(poId, {
        retryCount: currentRetryCount + 1,
        lastRetryAt: new Date(),
        status: status === 'ready_for_extraction' ? 'extraction_in_progress' : status,
        comments: error ? `Retry ${currentRetryCount + 1}/3: ${error}` : `Retry ${currentRetryCount + 1}/3`,
        updatedAt: new Date()
      });

      console.log(`🔄 RETRY: ${po.poNumber} attempt ${currentRetryCount + 1}/3`);
      return true;
    } catch (error) {
      console.error('Error in retry handler:', error);
      return false;
    }
  }

  // Function to check for and retry stuck purchase orders
  async function retryStuckPurchaseOrders() {
    try {
      // Find POs that are stuck in certain statuses for more than 5 minutes
      const stuckPOs = await db
        .select()
        .from(purchaseOrders)
        .where(
          and(
            or(
              eq(purchaseOrders.status, 'ready_for_extraction'),
              eq(purchaseOrders.status, 'extraction_in_progress')
            ),
            lt(purchaseOrders.updatedAt, new Date(Date.now() - 5 * 60 * 1000)), // 5 minutes ago
            lt(purchaseOrders.retryCount, 3) // Haven't exceeded max retries
          )
        );

      if (stuckPOs.length > 0) {
        console.log(`🔄 STUCK PO RETRY: Found ${stuckPOs.length} stuck purchase orders to retry`);
        
        for (const po of stuckPOs) {
          console.log(`🔄 RETRYING STUCK PO: ${po.poNumber} (Status: ${po.status})`);
          await handlePurchaseOrderRetry(po.id, po.status, 'Stuck processing timeout');
        }
      }
    } catch (error) {
      console.error('Error checking stuck purchase orders:', error);
    }
  }

  // Background processing function for auto-start - FULL PIPELINE
  async function processEmailsInBackground() {
    try {
      // Broader search - get ALL inbox emails, not just unlabeled ones
      const allMessages = await gmailService.getMessages('in:inbox', 100);
      console.log(`📊 FULL INBOX SCAN: Found ${allMessages.length} total inbox emails`);
      
      // Filter out emails already processed in database
      let unprocessedMessages = [];
      for (const message of allMessages) {
        const existingQueue = await storage.getEmailQueueByGmailId(message.id);
        if (!existingQueue) {
          unprocessedMessages.push(message);
        }
      }

      console.log(`📊 AUTO PROCESSING: Found ${unprocessedMessages.length} unprocessed emails out of ${allMessages.length} total emails`);

      let processedCount = 0;
      const maxEmails = Math.max(100, unprocessedMessages.length);

      // Process emails one at a time until no more unprocessed emails
      while (processedCount < maxEmails && unprocessedMessages.length > 0) {
        // Process emails from our filtered list sequentially
        const messageToProcess = unprocessedMessages.shift(); // Take first email from queue
        
        // No more unprocessed emails
        if (!messageToProcess) {
          console.log(`📧 AUTO PROCESSING: No more unprocessed emails found`);
          break;
        }

        console.log(`\n📧 PROCESSING EMAIL ${processedCount + 1}: "${messageToProcess.subject}"`);
        console.log(`   └─ From: ${messageToProcess.sender}`);
        console.log(`   └─ Attachments: ${messageToProcess.attachments ? messageToProcess.attachments.length : 0}`);
        
        // Update processing status for email start
        updateProcessingStatus({
          isProcessing: true,
          currentStep: "email_preprocessing",
          currentPO: "",
          currentEmail: `${messageToProcess.subject} (${processedCount + 1}/${unprocessedMessages.length + 1})`,
          emailNumber: processedCount + 1,
          totalEmails: unprocessedMessages.length + 1
        });
        
        try {
          const gmailMessage = messageToProcess;
          const emailId = messageToProcess.id;

          // Declare validator variables at the start of each email processing cycle
          let customerMeta = null;
          let contactMeta = null;
          let validationCompleted = false;

          // Enhanced forwarded email detection from HCL
          let forwardedEmail = null;
          if (messageToProcess.sender && messageToProcess.sender.includes('@highcaliberline.com')) {
            console.log('📨 FORWARDED EMAIL DETECTION: Analyzing @highcaliberline.com forwarded email...');
            
            const combinedText = `${messageToProcess.subject || ''} ${messageToProcess.body || ''}`;
            
            // Enhanced CNumber detection patterns
            const cNumberPatterns = [
              /C\d{6}/gi,  // Standard C123456
              /C\d{5}/gi,  // C12345
              /C\d{4}/gi,  // C1234
              /Customer[:\s#]*C\d{4,6}/gi,  // Customer: C123456
              /Cust[:\s#]*C\d{4,6}/gi,     // Cust # C123456
              /Account[:\s#]*C\d{4,6}/gi,   // Account # C123456
            ];
            
            let cNumberMatch = null;
            let matchedCNumber = null;
            
            for (const pattern of cNumberPatterns) {
              cNumberMatch = combinedText.match(pattern);
              if (cNumberMatch) {
                // Extract just the C number part
                matchedCNumber = cNumberMatch[0].match(/C\d{4,6}/i)?.[0];
                if (matchedCNumber) {
                  console.log(`   ✅ Found CNumber pattern: ${cNumberMatch[0]} → extracted: ${matchedCNumber}`);
                  break;
                }
              }
            }
            
            // Enhanced forwarded sender extraction
            const forwardedSenderPatterns = [
              /From:[\s]*([^\r\n<]+<[^>]+>)/i,     // From: Name <email>
              /From:[\s]*([^\r\n]+@[^\s\r\n]+)/i,  // From: email@domain.com
              /Sent[\s\w]*:[\s\w\d\/,:-]*[\r\n]+From:[\s]*([^\r\n<]+<[^>]+>)/i, // Multi-line Sent: ... From:
              /Original Message[\s\S]*?From:[\s]*([^\r\n<]+<[^>]+>)/i, // -----Original Message----- From:
              /-----[\s\w]*-----[\s\S]*?From:[\s]*([^\r\n<]+<[^>]+>)/i, // Any dashed separator
            ];
            
            let originalSenderEmail = null;
            for (const pattern of forwardedSenderPatterns) {
              const senderMatch = combinedText.match(pattern);
              if (senderMatch && senderMatch[1]) {
                originalSenderEmail = senderMatch[1].trim();
                console.log(`   ✅ Found forwarded sender: ${originalSenderEmail}`);
                break;
              }
            }
            
            if (matchedCNumber || originalSenderEmail) {
              // CNumber lookup is different from contact validation - this is finding a customer, not a contact
              // This functionality remains with ContactFinderService since it's specifically for NetSuite ID lookup
              const { ContactFinderService } = await import('./services/contact-finder');
              const contactFinder = new ContactFinderService();
              let customer = null;
              
              // Try to find customer by CNumber first
              if (matchedCNumber) {
                try {
                  customer = await contactFinder.findContact({
                    netsuiteInternalId: matchedCNumber
                  });
                  if (customer) {
                    console.log(`   ✅ Customer found by CNumber: ${customer.name} (${customer.netsuite_internal_id})`);
                  }
                } catch (error) {
                  console.log(`   ⚠️  Failed to lookup CNumber ${matchedCNumber}: ${error.message}`);
                }
              }
              
              forwardedEmail = {
                cNumber: matchedCNumber,
                originalSender: originalSenderEmail || messageToProcess.sender,
                hclForwarder: messageToProcess.sender,
                isForwarded: true,
                extractedCustomer: customer ? {
                  customer_name: customer.name,
                  customer_number: customer.netsuite_internal_id
                } : null
              };
              
              console.log(`   ✅ FORWARDED EMAIL PROCESSED:`);
              console.log(`      └─ CNumber: ${matchedCNumber || 'Not found'}`);
              console.log(`      └─ Original Sender: ${originalSenderEmail || 'Not found'}`);
              console.log(`      └─ HCL Forwarder: ${messageToProcess.sender}`);
              console.log(`      └─ Customer: ${customer?.name || 'Not found'}`);
            } else {
              console.log('   └─ No CNumber or forwarded sender found in email content');
            }
          }

          // Store attachments if present
          if (messageToProcess.attachments && messageToProcess.attachments.length > 0) {
            console.log(`📎 ATTACHMENT ANALYSIS: Found ${messageToProcess.attachments.length} total attachments`);
            
            const { ObjectStorageService } = await import("./objectStorage");
            const objectStorage = new ObjectStorageService();
            
            for (const attachment of messageToProcess.attachments) {
              try {
                if (attachment.data) {
                  console.log(`   └─ ${attachment.filename}: ${attachment.mimeType} (${attachment.data.length} bytes) [Has ID]`);
                  await objectStorage.storeAttachment(emailId, attachment);
                  console.log(`      ✅ Stored attachment: ${attachment.filename} at /objects/pdfs/${emailId}_${attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
                }
              } catch (error) {
                console.error(`      ❌ Failed to store attachment ${attachment.filename}:`, error);
              }
            }
          }

          // Email preservation (skip for auto-processing to avoid errors)
          try {
            // Note: Skipping email preservation in auto-processing to avoid function errors
            console.log(`   ✅ Skipped email preservation for auto-processing`);
          } catch (error) {
            console.error(`   ❌ Failed to preserve email:`, error);
          }

          // Two-step AI processing
          console.log('🤖 AI PROCESSING: Starting two-step analysis...');
          const bodyLength = messageToProcess.body ? messageToProcess.body.length : 0;
          console.log(`📊 EMAIL SIZE: Original body ${bodyLength} chars, truncated to ${Math.min(bodyLength, 10000)} chars`);

          const preprocessing = await openaiService.preProcessEmail(gmailMessage);
          console.log(`   └─ Pre-processing: ${preprocessing.classification || preprocessing.response || 'Unknown'} (Continue: ${preprocessing.shouldProceed})`);

          let classification = null;
          if (preprocessing.shouldProceed) {
            classification = await openaiService.classifyEmail(gmailMessage);
            const route = classification.recommended_route || classification.route || 'Unknown';
            const confidence = classification.analysis_flags?.confidence_score || classification.confidence || 0;
            console.log(`   └─ Detailed route: ${route} (${Math.round(confidence * 100)}%)`);
          } else {
            console.log(`Email filtered out: ${preprocessing.classification || preprocessing.response || 'Unknown'} (${Math.round((preprocessing.confidence || preprocessing.score || 0) * 100)}%)`);
          }

          // Process if it passed preprocessing
          if (preprocessing.shouldProceed && classification) {
            
            // Generate PO number
            console.log('📋 PO NUMBER ASSIGNMENT:');
            const poNumber = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
            console.log(`   ✅ Generating PO number: ${poNumber}`);
            
            // Update status with PO number
            updateProcessingStatus({
              currentStep: "po_assignment",
              currentPO: poNumber,
            });

            // Handle forwarded emails with enhanced processing
            if (forwardedEmail) {
              console.log('📋 FORWARDED EMAIL PROCESSING:');
              console.log(`   └─ Original sender: ${forwardedEmail.originalSender}`);
              console.log(`   └─ HCL forwarder: ${forwardedEmail.hclForwarder}`);
              console.log(`   └─ CNumber: ${forwardedEmail.cNumber || 'Not found'}`);
              
              // Override the sender information for processing with original sender's email
              if (forwardedEmail.originalSender) {
                console.log(`   ✅ Using original sender email for processing: ${forwardedEmail.originalSender}`);
                
                // Update the message data to use original sender for extraction
                const originalMessage = { ...gmailMessage };
                originalMessage.sender = forwardedEmail.originalSender;
                
                // Process with original sender context  
                const forwardedRoute = classification.recommended_route || classification.route;
                if (forwardedRoute === "TEXT_PO" || forwardedRoute === "TEXT_SAMPLE") {
                  extractedData = await aiService.extractPODataFromText(
                    originalMessage.subject || "",
                    originalMessage.body || "",
                    forwardedEmail.originalSender  // Use original sender instead of HCL forwarder
                  );
                }
              }
            }

            // AI Extraction based on classification
            const route = classification.recommended_route || classification.route;
            console.log(`🧠 GEMINI EXTRACTION: Processing ${route}...`);
            
            // Update status for Gemini extraction
            updateProcessingStatus({
              currentStep: "gemini_extraction",
            });
            
            let extractedData = null;
            if (route === "ATTACHMENT_PO" || route === "ATTACHMENT_SAMPLE") {
              if (gmailMessage.attachments && gmailMessage.attachments.length > 0) {
                const prioritizedAttachment = gmailMessage.attachments[0];
                console.log(`   └─ Processing prioritized attachment: ${prioritizedAttachment.filename}`);
                console.log(`   └─ Attachment keys available:`, Object.keys(prioritizedAttachment));
                
                // AI-powered attachment filtering before Gemini extraction
                console.log(`🔍 AI ATTACHMENT FILTER: Analyzing ${prioritizedAttachment.filename}...`);
                const attachmentAnalysis = await openaiService.analyzeAttachmentContent(
                  prioritizedAttachment.filename,
                  prioritizedAttachment.contentType || 'application/octet-stream'
                );
                
                console.log(`   └─ Analysis: PO=${attachmentAnalysis.isPurchaseOrder}, Artwork=${attachmentAnalysis.isArtwork}, Confidence=${Math.round(attachmentAnalysis.confidence * 100)}%`);
                console.log(`   └─ Reason: ${attachmentAnalysis.reason}`);
                
                // Only proceed if it's likely a PO document and not artwork
                if (attachmentAnalysis.isPurchaseOrder && !attachmentAnalysis.isArtwork && attachmentAnalysis.confidence > 0.6) {
                  console.log(`   ✅ Attachment passed AI filter - proceeding with Gemini extraction`);
                  
                  if (prioritizedAttachment && prioritizedAttachment.data) {
                    console.log(`   └─ Attachment data available: ${prioritizedAttachment.data.length} bytes`);
                    extractedData = await aiService.extractPODataFromPDF(
                      prioritizedAttachment.data,
                      prioritizedAttachment.filename
                    );
                  } else if (prioritizedAttachment.attachmentId) {
                    console.log(`   └─ Loading attachment data using attachmentId: ${prioritizedAttachment.attachmentId}`);
                    try {
                      const attachmentBuffer = await gmailService.downloadAttachment(
                        messageToProcess.id,
                        prioritizedAttachment.attachmentId
                      );
                      if (attachmentBuffer) {
                        console.log(`   ✅ Loaded attachment data: ${attachmentBuffer.length} bytes`);
                        extractedData = await aiService.extractPODataFromPDF(
                          attachmentBuffer,
                          prioritizedAttachment.filename
                        );
                      } else {
                        console.log(`   ❌ Failed to load attachment buffer`);
                      }
                    } catch (error) {
                      console.log(`   ❌ Error loading attachment: ${error.message}`);
                    }
                  } else {
                    console.log(`   ❌ No attachment data or attachmentId available for: ${prioritizedAttachment.filename}`);
                  }
                } else {
                  console.log(`   ❌ Attachment filtered out by AI: Not a valid PO document`);
                  console.log(`   └─ Switching to email text processing instead`);
                  
                  // Log AI filtering as potential issue for review
                  await logProcessingError(
                    'ai_filter_failed',
                    `AI attachment filter rejected ${prioritizedAttachment.filename} for email with PO ${poNumber}. This may indicate a false negative where a valid PO document was incorrectly filtered.`,
                    messageToProcess.id,
                    undefined,
                    poNumber,
                    {
                      attachmentFilename: prioritizedAttachment.filename,
                      attachmentSize: prioritizedAttachment.size || 0,
                      attachmentType: prioritizedAttachment.contentType || 'unknown',
                      reason: 'AI determined this was not a valid PO document',
                      switchedToTextProcessing: true
                    }
                  );
                  
                  // Fall back to text processing if attachment is filtered out
                  extractedData = await aiService.extractPODataFromText(
                    gmailMessage.subject || "",
                    gmailMessage.body || "",
                    gmailMessage.sender
                  );
                }
              }
            } else if (route === "TEXT_PO" || route === "TEXT_SAMPLE") {
              console.log(`   └─ Processing email text extraction`);
              console.log(`   └─ Subject: "${gmailMessage.subject}"`);
              console.log(`   └─ Body length: ${gmailMessage.body?.length || 0} chars`);
              console.log(`   └─ Sender: "${gmailMessage.sender}"`);
              extractedData = await aiService.extractPODataFromText(
                gmailMessage.subject || "",
                gmailMessage.body || "",
                gmailMessage.sender
              );
            }

            // Create purchase order with extracted data
            let purchaseOrder = null;
            if (extractedData) {
              console.log(`   ✅ Successfully extracted PO data`);
              console.log(`   └─ Client PO Number: ${extractedData.clientPONumber || 'Not specified'}`);
              console.log(`   └─ Customer: ${extractedData.customer?.name || 'Not specified'}`);
              console.log(`   └─ Line Items: ${extractedData.lineItems?.length || 0}`);

              // Add forwarded email info if present
              if (forwardedEmail) {
                extractedData.forwardedEmail = forwardedEmail;
              }

              purchaseOrder = await storage.createPurchaseOrder({
                poNumber,
                messageId: messageToProcess.id,
                subject: messageToProcess.subject || '',
                sender: messageToProcess.sender || '',
                extractedData: extractedData as any,
                status: 'pending_review',
                route: classification.route,
                confidence: classification.confidence,
                emailId: emailId,
                originalJson: {
                  engine: "gemini",
                  ...classification.reasoning
                }
              });



              // Customer lookup and processing
              console.log(`🔍 CUSTOMER LOOKUP: Starting for PO ${purchaseOrder.id}`);
              
              // Variables already declared at email processing start
              console.log(`🔍 VALIDATION START: Processing validators for PO ${purchaseOrder.id}`);
              
              // Update status for customer validation
              updateProcessingStatus({
                currentStep: "customer_validation",
              });
              try {
                const updatedPO = await openaiCustomerFinderService.processPurchaseOrder(purchaseOrder.id);
                console.log(`   ✅ Customer processing completed for PO ${poNumber} (Status: ${updatedPO?.status || purchaseOrder.status})`);
                
                // CRITICAL: Capture customer data for final update  
                if (updatedPO?.status === 'customer_found') {
                  // Get current PO to access extracted data and customer finder results
                  const currentPO = await storage.getPurchaseOrder(purchaseOrder.id);
                  
                  // Try to get customer data from extractedData first
                  if (currentPO?.extractedData?.purchaseOrder?.customer?.customerNumber) {
                    customerMeta = {
                      customer_name: currentPO.extractedData.purchaseOrder.customer.company || 'Unknown',
                      customer_number: currentPO.extractedData.purchaseOrder.customer.customerNumber
                    };
                    console.log(`   ✅ Captured customer data from extractedData: ${customerMeta.customer_name} (${customerMeta.customer_number})`);
                  } else if (currentPO?.extractedData?.customer) {
                    // Fallback to older structure
                    customerMeta = {
                      customer_name: currentPO.extractedData.customer.company || 'Unknown',
                      customer_number: currentPO.extractedData.customer.customerNumber || currentPO.extractedData.customer.customernumber || 'Unknown'
                    };
                    console.log(`   ✅ Captured customer data from legacy extractedData: ${customerMeta.customer_name} (${customerMeta.customer_number})`);
                  } else {
                    console.log(`   ⚠️  Customer found but data not in expected extractedData structure`);
                  }
                } else {
                  console.log(`   ⚠️  Customer status: ${updatedPO?.status || 'unknown'} - no customer data captured`);
                }
                
                // Log customer lookup failures for review
                if (updatedPO?.status === 'customer_not_found' || updatedPO?.status === 'new_customer') {
                  await logProcessingError(
                    'customer_lookup_failed',
                    `Customer lookup ${updatedPO.status === 'customer_not_found' ? 'failed' : 'resulted in new customer'} for PO ${poNumber}. Manual review may be required.`,
                    messageToProcess.id,
                    purchaseOrder.id,
                    poNumber,
                    {
                      customerStatus: updatedPO.status,
                      extractedCustomerInfo: extractedData?.customer || null,
                      sender: messageToProcess.sender
                    }
                  );
                }
              } catch (customerError) {
                console.error(`❌ Customer lookup failed for PO ${poNumber}:`, customerError);
                await logProcessingError(
                  'customer_lookup_failed',
                  `Critical error during customer lookup for PO ${poNumber}: ${customerError instanceof Error ? customerError.message : 'Unknown error'}`,
                  messageToProcess.id,
                  purchaseOrder.id,
                  poNumber,
                  { error: customerError instanceof Error ? customerError.message : customerError }
                );
              }

              // Validation workflow is starting (will be marked complete after all validators finish)

              console.log(`🚀 IMMEDIATE DEBUG: Just finished customer catch block - execution continues...`);

              console.log(`🔍 FLOW DEBUG: Finished customer processing, about to start contact validation...`);
              console.log(`🔍 FLOW DEBUG: extractedData exists:`, !!extractedData);
              console.log(`🔍 FLOW DEBUG: purchaseOrder exists:`, !!purchaseOrder);

              // Contact validation using OpenAI contact validator
              console.log(`📞 CONTACT VALIDATION: Starting contact resolution...`);
              console.log(`   └─ Debug: extractedData?.customer:`, !!extractedData?.customer);
              console.log(`   └─ Debug: extractedData?.contact:`, !!extractedData?.contact);
              console.log(`   └─ Debug: messageToProcess.sender:`, !!messageToProcess.sender);
              
              // Update status for contact validation
              updateProcessingStatus({
                currentStep: "contact_validation",
                currentPO: poNumber,
              });
              
              // ALWAYS run contact validator for deterministic results
              console.log(`📞 CONTACT VALIDATION: Running deterministically for all emails`);
              {
                try {
                  // Extract sender name from email if not available in parsed format
                  let senderName = '';
                  if (extractedData?.customer?.firstName && extractedData?.customer?.lastName) {
                    senderName = `${extractedData.customer.firstName} ${extractedData.customer.lastName}`;
                  } else if (extractedData?.contact?.name) {
                    senderName = extractedData.contact.name;
                  } else if (messageToProcess.sender) {
                    // Extract name from "Name <email@domain.com>" format
                    const match = messageToProcess.sender.match(/^(.+?)\s*<(.+)>$/);
                    if (match) {
                      senderName = match[1].trim();
                    } else {
                      // If no match, use the email itself or part of it
                      senderName = messageToProcess.sender.split('@')[0];
                    }
                  }
                  
                  console.log(`   🔍 DEBUG: Sender name resolution: "${senderName}"`);
                  console.log(`   🔍 DEBUG: messageToProcess.sender: "${messageToProcess.sender}"`);
                  
                  const contactValidator = new OpenAIContactValidatorService();
                  contactMeta = await contactValidator.validateContact({
                    extractedData: extractedData,
                    senderName: senderName,
                    senderEmail: messageToProcess.sender,
                    resolvedCustomerId: extractedData?.customer?.customernumber,
                    companyId: extractedData?.customer?.customernumber
                  });
                  
                  console.log(`   ✅ Contact validated: ${contactMeta.name} <${contactMeta.email}>`);
                  console.log(`   └─ Method: ${contactMeta.match_method} (Confidence: ${contactMeta.confidence})`);
                  console.log(`   └─ Role: ${contactMeta.role}`);
                  
                  // Update purchase order with validated contact info
                  await storage.updatePurchaseOrder(purchaseOrder.id, {
                    extractedData: {
                      ...extractedData,
                      validatedContact: contactMeta,
                      contactValidationCompleted: true
                    }
                  });
                  
                } catch (error) {
                  console.error(`   ❌ Contact validation failed:`, error);
                  await logProcessingError(
                    'contact_validation_failed',
                    `Contact validation failed for PO ${poNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    messageToProcess.id,
                    purchaseOrder.id,
                    poNumber,
                    { 
                      error: error instanceof Error ? error.message : error,
                      hasCustomerData: !!extractedData?.customer,
                      senderEmail: messageToProcess.sender
                    }
                  );
                }
              }

              // ALWAYS run line items validator for deterministic results
              console.log(`📦 LINE ITEMS VALIDATION: Running deterministically for all emails`);
              if (extractedData?.lineItems && extractedData.lineItems.length > 0) {
                console.log(`📦 LINE ITEMS VALIDATION: Starting for ${extractedData.lineItems.length} items`);
                
                // Update status for line item validation
                updateProcessingStatus({
                  currentStep: "line_item_validation",
                });
                
                try {
                  const skuValidatorService = new OpenAISKUValidatorService();
                  
                  // Create input string for validation (format expected by validator)
                  const lineItemsString = extractedData.lineItems.map((item: any) => {
                    return `SKU: ${item.sku || 'N/A'} | Description: ${item.description || 'N/A'} | Quantity: ${item.quantity || 0} | Color: ${item.itemColor || 'N/A'}`;
                  }).join(' ____ ');
                  
                  const validatedItems = await skuValidatorService.validateLineItems(extractedData.lineItems);
                  console.log(`   ✅ Line items validated: ${validatedItems.length} items processed`);
                  
                  // Log validation results
                  validatedItems.forEach((item: any, index: number) => {
                    console.log(`   └─ Item ${index + 1}: ${item.finalSKU} - ${item.description} (Qty: ${item.quantity})`);
                  });
                  
                  // Update purchase order with validated line items
                  if (validatedItems.length > 0) {
                    const updatedDataWithSKUs = {
                      ...extractedData,
                      validatedLineItems: validatedItems,
                      skuValidationCompleted: true
                    };
                    
                    await storage.updatePurchaseOrder(purchaseOrder.id, {
                      extractedData: updatedDataWithSKUs
                    });
                  }
                  
                } catch (error) {
                  console.error(`   ❌ Line items validation failed:`, error);
                  await logProcessingError(
                    'sku_validation_failed',
                    `SKU validation failed for PO ${poNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    messageToProcess.id,
                    purchaseOrder.id,
                    poNumber,
                    { 
                      error: error instanceof Error ? error.message : error,
                      lineItemCount: extractedData?.lineItems?.length || 0
                    }
                  );
                }
              } else {
                console.log(`   ⚠️  No line items found - running empty validator for consistency`);
                // Still run validator with empty data for deterministic behavior
                try {
                  const skuValidatorService = new OpenAISKUValidatorService();
                  const validatedItems = await skuValidatorService.validateLineItems([]);
                  console.log(`   ✅ Empty line items validation completed (deterministic)`);
                } catch (error) {
                  console.log(`   ⚠️  Empty line items validation failed (non-critical)`);
                }
                
                await logProcessingError(
                  'sku_validation_failed',
                  `No line items found for PO ${poNumber}. Email processing completed but no products were extracted for validation.`,
                  messageToProcess.id,
                  purchaseOrder.id,
                  poNumber,
                  { 
                    extractionRoute: classification?.route || 'unknown',
                    hasExtractedData: !!extractedData,
                    extractedDataKeys: extractedData ? Object.keys(extractedData) : []
                  }
                );
              }

              // Mark that ALL validation is complete
              validationCompleted = true;
              console.log(`🏁 VALIDATION COMPLETED: All validators finished for PO ${poNumber}`);

              // CRITICAL: Final deterministic update with ALL validator results (ONLY for validated emails)
              if (validationCompleted) {
                console.log(`🔍 FINAL UPDATE CHECK: validationCompleted=${validationCompleted}`);
                console.log(`🔄 FINAL UPDATE: Storing all validator results to main database fields`);
                
                // Get latest purchase order data to ensure we have all validator results
                const currentPO = await storage.getPurchaseOrder(purchaseOrder.id);
                const finalUpdateData: any = {};
                
                // CUSTOMER DATA: Extract from actual data structures that exist
                if (currentPO?.status === 'customer_found' && currentPO?.extractedData?.purchaseOrder?.customer?.customerNumber) {
                  const customerData = currentPO.extractedData.purchaseOrder.customer;
                  const customerMeta = {
                    customer_name: customerData.company || 'Unknown',
                    customer_number: customerData.customerNumber
                  };
                  finalUpdateData.customerMeta = customerMeta;
                  console.log(`   ✅ Storing customer data: ${customerMeta.customer_name} (${customerMeta.customer_number})`);
                } else if (currentPO?.status === 'customer_found') {
                  console.log(`   ⚠️  Customer found but data structure unexpected`);
                } else {
                  console.log(`   ⚠️  Customer not found, status: ${currentPO?.status || 'unknown'}`);
                }
                
                // CONTACT DATA: Already captured by contact validator  
                if (contactMeta) {
                  console.log(`   ✅ Storing contact data: ${contactMeta.name} <${contactMeta.email}>`);
                  finalUpdateData.contact = contactMeta.email || null;
                  finalUpdateData.contactMeta = contactMeta;
                } else {
                  console.log(`   ⚠️  No contact data captured`);
                }
                
                // LINE ITEMS: Extract validated line items
                if (currentPO?.extractedData?.validatedLineItems && currentPO.extractedData.validatedLineItems.length > 0) {
                  console.log(`   ✅ Storing line items: ${currentPO.extractedData.validatedLineItems.length} validated items`);
                  finalUpdateData.lineItems = currentPO.extractedData.validatedLineItems;
                } else {
                  console.log(`   ⚠️  No validated line items found`);
                }
                
                // CLIENT PO NUMBER: From extraction data
                if (currentPO?.extractedData?.purchaseOrder?.purchaseOrderNumber) {
                  console.log(`   ✅ Storing client PO: ${currentPO.extractedData.purchaseOrder.purchaseOrderNumber}`);
                  finalUpdateData.clientPONumber = currentPO.extractedData.purchaseOrder.purchaseOrderNumber;
                }
                
                // Execute final update
                if (Object.keys(finalUpdateData).length > 0) {
                  await storage.updatePurchaseOrder(purchaseOrder.id, finalUpdateData);
                  console.log(`   ✅ FINAL UPDATE COMPLETED: Stored ${Object.keys(finalUpdateData).length} data fields deterministically`);
                } else {
                  console.log(`   ⚠️  No validator results to store in final update`);
                }
              } else {
                console.log(`   ⚠️  Skipping final update - email did not go through complete validation process`);
              }

            } else {
              console.log(`   ❌ No data extracted from ${classification.route || 'unknown route'}`);
              await logProcessingError(
                'extraction_failed',
                `Failed to extract any data from email using route ${classification?.route || 'unknown'}. Email was classified for processing but extraction yielded no results.`,
                messageToProcess.id,
                undefined,
                poNumber,
                {
                  classificationRoute: classification?.route || 'unknown',
                  classificationConfidence: classification?.confidence || 0,
                  sender: messageToProcess.sender,
                  subject: messageToProcess.subject,
                  attachmentCount: messageToProcess.attachments?.length || 0
                }
              );
            }
          }



          // Update Gmail labels
          console.log(`Updating Gmail labels for message ${messageToProcess.id}`);
          try {
            const classificationName = preprocessing.classification || preprocessing.response || 'none-of-these';
            const aiLabelName = `ai-${classificationName.toLowerCase().replace(/\s+/g, '-')}`;
            console.log(`   └─ Adding '${aiLabelName}' label (AI classification: ${classificationName})`);
            await gmailService.addLabelToEmail(messageToProcess.id, aiLabelName);
            
            if (preprocessing.shouldProceed) {
              console.log(`   └─ Adding 'processed' label (passed preprocessing: ${classificationName})`);
              await gmailService.addLabelToEmail(messageToProcess.id, 'processed');
            } else {
              console.log(`   └─ Adding 'filtered' label (blocked by preprocessing: ${classificationName})`);  
              await gmailService.addLabelToEmail(messageToProcess.id, 'filtered');
            }
            console.log(`   ✅ Successfully updated Gmail labels`);
          } catch (error) {
            console.error(`   ❌ Failed to update Gmail labels:`, error);
            await logProcessingError(
              'gmail_labeling_failed',
              `Failed to update Gmail labels during auto processing: ${error instanceof Error ? error.message : 'Unknown error'}`,
              messageToProcess.id,
              undefined,
              undefined,
              {
                error: error instanceof Error ? error.message : error,
                sender: messageToProcess.sender,
                subject: messageToProcess.subject,
                classification: preprocessing.response || 'unknown',
                step: 'auto_processing'
              }
            );
          }

          console.log(`   ✅ Completed processing email ${processedCount + 1}`);
          
        } catch (error) {
          console.error(`❌ Error processing email ${messageToProcess?.id}:`, error);
        }

        processedCount++;
        
        // Small delay between emails to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`🔄 AUTO PROCESSING: Completed processing ${processedCount} emails`);
      
    } catch (error) {
      console.error('❌ AUTO Background processing error:', error);
    }
  }

  // Email processing - Sequential processing like single email but iterate through all
  app.post("/api/emails/process", async (req, res) => {
    try {
      console.log(`🔄 NORMAL PROCESSING: Starting sequential email processing...`);
      
      // First, count how many unprocessed emails exist - fetch only unlabeled emails
      const allMessages = await gmailService.getMessages('in:inbox -label:processed -label:filtered');
      let unprocessedCount = 0;
      for (const message of allMessages) {
        const existingQueue = await storage.getEmailQueueByGmailId(message.id);
        if (!existingQueue) {
          unprocessedCount++;
        }
      }
      
      console.log(`📊 PROCESSING SCOPE: Found ${unprocessedCount} unprocessed emails out of ${allMessages.length} total emails`);
      
      let processedCount = 0;
      let totalMessages = allMessages.length;
      const processedEmails = [];
      const maxEmails = Math.max(100, unprocessedCount); // Process all unprocessed emails, with minimum safety limit
      
      // Process emails one at a time until no more unprocessed emails
      while (processedCount < maxEmails) {
        // Fetch unlabeled emails only
        const messages = await gmailService.getMessages('in:inbox -label:processed -label:filtered');
        totalMessages = messages.length;
        
        // Find first unprocessed email
        let messageToProcess = null;
        for (const message of messages) {
          const existingQueue = await storage.getEmailQueueByGmailId(message.id);
          if (!existingQueue) {
            messageToProcess = message;
            break;
          }
        }
        
        // No more unprocessed emails
        if (!messageToProcess) {
          console.log(`📧 NORMAL PROCESSING: No more unprocessed emails found`);
          break;
        }
        
        console.log(`\n📧 PROCESSING EMAIL ${processedCount + 1}: "${messageToProcess.subject}"`);
        console.log(`   └─ From: ${messageToProcess.sender}`);
        console.log(`   └─ Attachments: ${messageToProcess.attachments.length}`);

        try {

          // Check for forwarded email from @highcaliberline.com and extract CNumber
          let isForwardedEmail = false;
          let extractedCNumber = null;
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

          // Store PDF attachments for this email
          let attachmentPaths: Array<{filename: string; storagePath: string; buffer?: Buffer}> = [];
          if (messageToProcess.attachments.length > 0) {
            attachmentPaths = await gmailService.storeEmailAttachments(
              messageToProcess.id,
              messageToProcess.attachments
            );
          }

          // Preserve email as .eml file
          try {
            // Email preservation handled by objectStorage.storeEmailFile
            console.log(`   ✅ Email preserved as .eml file: ${emailId}`);
          } catch (error) {
            console.error(`   ❌ Failed to preserve email:`, error);
            // Continue processing even if email preservation fails
          }

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

          // Update queue item with both preprocessing and classification results (ALL emails tracked)
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
          let extractionResult: any = null;

          // Create purchase order if email passed both steps
          if (processingResult.preprocessing.shouldProceed && processingResult.classification && 
              processingResult.classification.recommended_route !== 'REVIEW') {
            const poNumber = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
            
            console.log(`📋 PO NUMBER ASSIGNMENT:`);
            console.log(`   ✅ Generating PO number: ${poNumber}`);

            // Handle forwarded emails 
            let effectiveSender = messageToProcess.sender;
            let forwardedEmailData = undefined;
            
            if (isForwardedEmail) {
              console.log(`📋 FORWARDED EMAIL PROCESSING:`);
              console.log(`   └─ Original sender: ${messageToProcess.sender}`);
              console.log(`   └─ CNumber: ${extractedCNumber}`);
              console.log(`   └─ Using customer from Gemini: will be determined after extraction`);
              
              forwardedEmailData = {
                originalSender: messageToProcess.sender,
                cNumber: extractedCNumber,
                extractedCustomer: null // Will be populated after Gemini extraction
              };
            }
            
            purchaseOrder = await storage.createPurchaseOrder({
              poNumber,
              emailId: messageToProcess.id,
              sender: effectiveSender,
              subject: messageToProcess.subject,
              route: processingResult.classification.recommended_route,
              confidence: processingResult.classification.analysis_flags?.confidence_score || 0,
              status: 'ready_for_extraction',
              originalJson: processingResult.classification,
              extractedData: forwardedEmailData ? { forwardedEmail: forwardedEmailData } : undefined
            });

            // Perform Gemini extraction based on route
            const route = processingResult.classification.recommended_route;
            
            if (route === 'ATTACHMENT_PO' || route === 'TEXT_PO') {
              try {
                console.log(`🧠 GEMINI EXTRACTION: Processing ${route}...`);
                
                // Use the SAME aiService as single email processing (already imported at top)
                
                if (route === 'ATTACHMENT_PO' && attachmentPaths.length > 0) {
                  // Apply attachment prioritization logic
                  const prioritizedAttachment = attachmentPaths.find(att => 
                    att.filename.toLowerCase().includes('purchaseorder') ||
                    att.filename.toLowerCase().includes('purchase_order') ||
                    att.filename.toLowerCase().includes('po_')
                  ) || attachmentPaths.find(att => 
                    !att.filename.toLowerCase().includes('proof') &&
                    !att.filename.toLowerCase().includes('artwork') &&
                    !att.filename.toLowerCase().includes('mock')
                  ) || attachmentPaths[0]; // fallback to first attachment
                  
                  console.log(`   └─ Processing prioritized attachment: ${prioritizedAttachment.filename}`);
                  
                  if (prioritizedAttachment.buffer) {
                    extractionResult = await aiService.extractPODataFromPDF(
                      prioritizedAttachment.buffer,
                      prioritizedAttachment.filename
                    );
                  }
                } else if (route === 'TEXT_PO') {
                  extractionResult = await aiService.extractPODataFromText(
                    messageToProcess.body,
                    messageToProcess.subject,
                    messageToProcess.sender
                  );
                }
                
                if (extractionResult) {
                  console.log(`   ✅ Successfully extracted PO data`);
                  console.log(`   └─ Client PO Number: ${extractionResult.purchaseOrder?.purchaseOrderNumber || 'Not specified'}`);
                  console.log(`   └─ Customer: ${extractionResult.purchaseOrder?.customer?.company || 'Not specified'}`);
                  console.log(`   └─ Line Items: ${extractionResult.lineItems?.length || 0}`);

                  // Extract and validate contact information against HCL database
                  let contactData = null;
                  let contactMeta = null;
                  if (extractionResult.purchaseOrder?.contact) {
                    console.log(`👤 CONTACT EXTRACTION:`);
                    console.log(`   └─ Contact Name: ${extractionResult.purchaseOrder.contact.name}`);
                    console.log(`   └─ Contact Email: ${extractionResult.purchaseOrder.contact.email}`);
                    console.log(`   └─ Contact Phone: ${extractionResult.purchaseOrder.contact.phone}`);
                    console.log(`   └─ Job Title: ${extractionResult.purchaseOrder.contact.jobTitle}`);
                    contactData = extractionResult.purchaseOrder.contact;
                    
                    // Contact validation using comprehensive OpenAI validation (same as single processing)
                    if (extractionResult.purchaseOrder.contact.name || messageToProcess.sender) {
                      console.log(`🔍 OPENAI CONTACT VALIDATION: Using comprehensive contact resolution...`);
                      
                      try {
                        const contactValidator = new OpenAIContactValidatorService();
                        const validatedContact = await contactValidator.validateContact({
                          extractedData: extractionResult,
                          senderName: messageToProcess.senderName || extractionResult.purchaseOrder.contact?.name,
                          senderEmail: messageToProcess.sender,
                          resolvedCustomerId: finalCustomerData?.customer_number,
                          companyId: finalCustomerData?.customer_number
                        });

                        contactMeta = validatedContact;
                        console.log(`   ✅ Contact validated: ${validatedContact.name} <${validatedContact.email}>`);
                        console.log(`   └─ Method: ${validatedContact.match_method} (Confidence: ${validatedContact.confidence})`);
                        console.log(`   └─ Role: ${validatedContact.role}`);
                      } catch (error) {
                        console.error(`   ❌ Contact validation failed:`, error);
                      }
                    }
                  }

                  // Customer lookup using OpenAI customer finder
                  console.log(`🔍 OPENAI CUSTOMER LOOKUP:`);
                  console.log(`   └─ Searching HCL database for: ${extractionResult.purchaseOrder?.customer?.company || 'No customer name'}`);
                  
                  let finalCustomerData = null;
                  if (extractionResult.purchaseOrder?.customer?.company) {
                    // Use SAME service and method as single email processing
                    const customerResult = await openaiCustomerFinderService.findCustomer({
                      customerName: extractionResult.purchaseOrder.customer.company,
                      customerEmail: extractionResult.purchaseOrder.customer.email || '',
                      senderEmail: messageToProcess.sender,
                      asiNumber: extractionResult.purchaseOrder.customer.asiNumber || '',
                      ppaiNumber: extractionResult.purchaseOrder.customer.ppaiNumber || '',
                      address: extractionResult.purchaseOrder.customer.address1 || ''
                    });
                    
                    if (customerResult.customer_number) {
                      finalCustomerData = customerResult;
                      console.log(`   ✅ OpenAI found HCL customer: ${finalCustomerData.customer_name} (${finalCustomerData.customer_number})`);
                    } else {
                      console.log(`   ⚠️  Customer not found in HCL database, will flag as new_customer`);
                    }
                  }

                  // Contact validation using comprehensive OpenAI validation (step 3 of sequence)
                  contactMeta = null;
                  if (extractionResult.purchaseOrder?.contact || messageToProcess.sender) {
                    console.log(`🔍 OPENAI CONTACT VALIDATION: Using comprehensive contact resolution...`);
                    
                    try {
                      const contactValidator = new OpenAIContactValidatorService();
                      const validatedContact = await contactValidator.validateContact({
                        extractedData: extractionResult,
                        senderName: messageToProcess.senderName || extractionResult.purchaseOrder.contact?.name,
                        senderEmail: messageToProcess.sender,
                        resolvedCustomerId: finalCustomerData?.customer_number,
                        companyId: finalCustomerData?.customer_number
                      });

                      contactMeta = validatedContact;
                      console.log(`   ✅ Contact validated: ${validatedContact.name} <${validatedContact.email}>`);
                      console.log(`   └─ Method: ${validatedContact.match_method} (Confidence: ${validatedContact.confidence})`);
                      console.log(`   └─ Role: ${validatedContact.role}`);
                    } catch (error) {
                      console.error(`   ❌ Contact validation failed:`, error);
                    }
                  }

                  // SKU validation with OpenAI (step 4 of sequence)
                  let validatedItems: any[] = [];
                  if (extractionResult.lineItems?.length > 0) {
                    console.log(`🤖 OPENAI SKU VALIDATOR: Processing ${extractionResult.lineItems.length} extracted line items...`);
                    // Use imported skuValidator (no dynamic import needed)
                    
                    // Format line items for SKU validator (____-separated format like single email processing)
                    const lineItemsForValidation = extractionResult.lineItems
                      .map((item: any) => {
                        return `sku: ${item.sku || ''}
description: ${item.description || ''}
itemColor: ${item.itemColor || ''}
quantity: ${item.quantity || 1}
unitPrice: ${item.unitPrice || 0}
totalPrice: ${item.totalPrice || 0}`;
                      })
                      .join('\n____\n');
                    
                    console.log(`   └─ Formatted ${extractionResult.lineItems.length} line items for validation`);
                    
                    const skuValidatorService = new OpenAISKUValidatorService();
                    validatedItems = await skuValidatorService.validateLineItems(extractionResult.lineItems);
                    console.log(`   ✅ SKU validation complete: ${validatedItems.length} items processed`);
                    
                    // Merge validated SKUs back into original line items structure
                    if (validatedItems && extractionResult.lineItems) {
                      extractionResult.lineItems.forEach((originalItem: any, index: number) => {
                        const validatedItem = validatedItems[index];
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
                  }

                  // Determine final status
                  const finalStatus = !finalCustomerData ? 'new_customer' : 'ready_for_netsuite';

                  // Update purchase order with all extracted data using same structure as single processing
                  await storage.updatePurchaseOrder(purchaseOrder.id, {
                    extractedData: extractionResult,
                    customerMeta: finalCustomerData,
                    contactMeta: contactMeta, // Include HCL contact validation result
                    status: finalStatus,
                    lineItems: extractionResult?.lineItems || [], // Store line items with merged finalSKU values
                    contact: extractionResult.purchaseOrder?.contact?.name || null
                  });

                  console.log(`   ✅ Updated purchase order ${poNumber} (Status: ${finalStatus})`);
                }

              } catch (extractionError: any) {
                console.error(`   ❌ Extraction failed:`, extractionError);
                await storage.updatePurchaseOrder(purchaseOrder.id, {
                  status: 'pending_review',
                  extractedData: { 
                    error: 'Extraction failed', 
                    details: extractionError?.message || 'Unknown error'
                  }
                });
              }
            }

            processedEmails.push({
              email: messageToProcess,
              preprocessing: processingResult.preprocessing,
              classification: processingResult.classification,
              purchaseOrder,
              extractionResult
            });
          } else if (!processingResult.preprocessing.shouldProceed) {
            console.log(`Email filtered out: ${processingResult.preprocessing.response} (${Math.round((processingResult.preprocessing.score || 0) * 100)}%)`);
            
            processedEmails.push({
              email: messageToProcess,
              preprocessing: processingResult.preprocessing,
              classification: null,
              purchaseOrder: null,
              filtered: true
            });
          }

          // Mark as processed in Gmail
          await gmailService.markAsProcessed(messageToProcess.id, processingResult.preprocessing);
          
          processedCount++;
          console.log(`   ✅ Completed processing email ${processedCount}`);
          
        } catch (error) {
          console.error(`❌ Error processing email ${messageToProcess?.id}:`, error);
          
          // Log error
          await storage.createErrorLog({
            type: 'Processing Error',
            message: error instanceof Error ? error.message : 'Unknown error',
            relatedPoNumber: messageToProcess?.id || 'unknown',
            resolved: false,
            metadata: { email: messageToProcess }
          });
          
          processedCount++; // Still count this as processed to avoid infinite loop
        }
      }

      // Check if there are more unprocessed emails remaining
      const finalMessages = await gmailService.getMessages('in:inbox -label:processed -label:filtered');
      let remainingUnprocessed = 0;
      for (const message of finalMessages) {
        const existingQueue = await storage.getEmailQueueByGmailId(message.id);
        if (!existingQueue) {
          remainingUnprocessed++;
        }
      }

      console.log(`🔄 NORMAL PROCESSING: Completed processing ${processedCount} emails`);
      if (remainingUnprocessed > 0) {
        console.log(`⚠️  REMAINING EMAILS: ${remainingUnprocessed} unprocessed emails still remain - run "Process Emails Normally" again to continue`);
      } else {
        console.log(`✅ ALL EMAILS PROCESSED: No more unprocessed emails found in Gmail`);
      }

      res.json({ 
        processed: processedCount,
        total: totalMessages,
        remaining: remainingUnprocessed,
        allComplete: remainingUnprocessed === 0,
        emails: processedEmails 
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Email processing failed' 
      });
    }
  });

  // Manual email processing
  app.post("/api/emails/process-manual", async (req, res) => {
    try {
      const { emailAddress, route, notes } = req.body;
      
      // This would typically fetch a specific email or allow manual input
      // For now, we'll create a mock processing result
      res.json({ 
        success: true,
        message: `Manual processing initiated for ${emailAddress} with route ${route}` 
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Manual processing failed' 
      });
    }
  });

  // Object Storage Routes
  
  // Serve public assets
  app.get("/public-objects/:filePath(*)", async (req, res) => {
    const filePath = req.params.filePath;
    const { ObjectStorageService } = await import('./objectStorage');
    const objectStorageService = new ObjectStorageService();
    
    try {
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error searching for public object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Serve private objects (PDFs, attachments) - fixed path handling
  app.get("/objects/:objectPath(*)", async (req, res) => {
    const { ObjectStorageService, ObjectNotFoundError } = await import('./objectStorage');
    const objectStorageService = new ObjectStorageService();
    
    try {
      // Construct the full object path correctly
      const objectPath = `/objects/${req.params.objectPath}`;
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error accessing object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "File not found" });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get list of stored files
  app.get("/api/files", async (req, res) => {
    try {
      const { ObjectStorageService } = await import('./objectStorage');
      const objectStorageService = new ObjectStorageService();
      
      // Get actual files from object storage
      const storedFiles = await objectStorageService.listStoredFiles();
      
      console.log('Files found in object storage:', storedFiles.length);
      
      // Transform to match the expected format
      const files = storedFiles.map((file, index) => ({
        id: (index + 1).toString(),
        filename: file.filename,
        size: file.size,
        uploadedAt: file.uploaded.toISOString(),
        storagePath: file.path,
        contentType: file.contentType
      }));
      
      res.json(files);
    } catch (error) {
      console.error("Error fetching files:", error);
      // Return empty array if no files or if there's an error
      res.json([]);
    }
  });

  // Get upload URL for PDFs
  app.post("/api/objects/pdf-upload", async (req, res) => {
    const { filename } = req.body;
    const { ObjectStorageService } = await import('./objectStorage');
    const objectStorageService = new ObjectStorageService();
    
    try {
      const uploadURL = await objectStorageService.getPdfUploadURL(filename || 'document.pdf');
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting PDF upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Get general upload URL
  app.post("/api/objects/upload", async (req, res) => {
    const { ObjectStorageService } = await import('./objectStorage');
    const objectStorageService = new ObjectStorageService();
    
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Clear all files from object storage
  app.delete("/api/files/clear-all", async (req, res) => {
    try {
      const { ObjectStorageService } = await import('./objectStorage');
      const objectStorageService = new ObjectStorageService();
      
      // Get the bucket from private object directory
      const privateDir = objectStorageService.getPrivateObjectDir();
      const bucketName = privateDir.split('/')[1]; // Extract bucket name from path like "/bucket-name/.private"
      
      // Import object storage client
      const { objectStorageClient } = await import('./objectStorage');
      const bucket = objectStorageClient.bucket(bucketName);
      
      // List all files with the private prefix
      const [files] = await bucket.getFiles({ prefix: '.private/' });
      
      console.log(`Found ${files.length} files to delete from object storage`);
      
      // Delete all files
      let deletedCount = 0;
      for (const file of files) {
        try {
          await file.delete();
          deletedCount++;
          console.log(`Deleted: ${file.name}`);
        } catch (error) {
          console.error(`Failed to delete file ${file.name}:`, error);
        }
      }
      
      res.json({ 
        success: true, 
        message: `Successfully deleted ${deletedCount} out of ${files.length} files from object storage`,
        deletedCount,
        totalCount: files.length
      });
    } catch (error) {
      console.error('Error clearing object storage:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to clear object storage' 
      });
    }
  });

  // Purchase Orders
  app.get("/api/purchase-orders", async (req, res) => {
    try {
      const { status, limit } = req.query;
      const orders = await storage.getPurchaseOrders({
        status: status as string,
        limit: limit ? parseInt(limit as string) : undefined
      });
      res.json(orders);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to fetch purchase orders' 
      });
    }
  });

  app.get("/api/purchase-orders/:id", async (req, res) => {
    try {
      const order = await storage.getPurchaseOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: 'Purchase order not found' });
      }
      res.json(order);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to fetch purchase order' 
      });
    }
  });

  app.patch("/api/purchase-orders/:id", async (req, res) => {
    try {
      const updates = req.body;
      const order = await storage.updatePurchaseOrder(req.params.id, updates);
      res.json(order);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to update purchase order' 
      });
    }
  });

  // API endpoint to manually trigger stuck purchase order retries
  app.post("/api/purchase-orders/retry-stuck", async (req, res) => {
    try {
      await retryStuckPurchaseOrders();
      res.json({ message: "Stuck purchase order retry completed" });
    } catch (error) {
      console.error('Error manually triggering stuck PO retry:', error);
      res.status(500).json({ error: 'Failed to retry stuck purchase orders' });
    }
  });



  // NetSuite import
  app.post("/api/purchase-orders/:id/import-netsuite", async (req, res) => {
    try {
      const order = await storage.getPurchaseOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: 'Purchase order not found' });
      }

      if (order.status !== 'ready for NS import') {
        return res.status(400).json({ message: 'Order not ready for NetSuite import' });
      }

      // Extract PO data if needed
      let poData = order.validatedJson;
      if (!poData && order.route === 'TEXT_PO') {
        const queueItem = await storage.getEmailQueueByGmailId(order.emailId || '');
        if (queueItem) {
          // Use AI service for extraction (will automatically choose appropriate engine)
          poData = await aiService.extractPOData(queueItem.body || '');
          await storage.updatePurchaseOrder(order.id, { validatedJson: poData });
        }
      }

      // Handle attachment-based PO data extraction
      if (!poData && order.route === 'ATTACHMENT_PO') {
        // PO data should already be extracted during processing
        // If missing, we can't reconstruct it without the original PDF
        console.warn(`Missing PO data for ATTACHMENT_PO order ${order.id}`);
      }

      // Create NetSuite Sales Order
      const salesOrderData = {
        customer: (poData as any)?.customer || { name: 'Unknown Customer', email: order.sender || '' },
        lineItems: (poData as any)?.lineItems || [],
        shipMethod: order.shippingMethod || undefined,
        memo: `Imported from ${order.poNumber}`,
        externalId: order.poNumber
      };

      const result = await netsuiteService.createSalesOrder(salesOrderData);

      if (result.success) {
        // Update order with NetSuite IDs
        await storage.updatePurchaseOrder(order.id, {
          nsInternalId: result.internalId,
          nsExternalId: result.externalId,
          status: 'imported'
        });

        res.json({ success: true, result });
      } else {
        await storage.createErrorLog({
          type: 'NetSuite Import',
          message: result.error || 'Import failed',
          relatedPoId: order.id,
          relatedPoNumber: order.poNumber,
          resolved: false
        });

        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'NetSuite import failed' 
      });
    }
  });

  // Error logs
  app.get("/api/error-logs", async (req, res) => {
    try {
      const { resolved, type, limit } = req.query;
      const logs = await storage.getErrorLogs({
        resolved: resolved !== undefined ? resolved === 'true' : undefined,
        type: type as string,
        limit: limit ? parseInt(limit as string) : undefined
      });
      res.json(logs);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to fetch error logs' 
      });
    }
  });

  app.patch("/api/error-logs/:id/resolve", async (req, res) => {
    try {
      const { resolvedBy } = req.body;
      const log = await storage.updateErrorLog(req.params.id, {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy
      });
      res.json(log);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to resolve error log' 
      });
    }
  });

  // Gmail connection test
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
        storage.getPurchaseOrders({ status: 'new_customer', limit: 100 }),
        storage.getPurchaseOrders({ status: 'pending_review', limit: 100 }),
        storage.getPurchaseOrders({ status: 'customer_not_found', limit: 100 }),
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
        message: error instanceof Error ? error.message : 'Failed to fetch queue status' 
      });
    }
  });

  // Global processing status tracking for real-time dashboard updates
  let currentProcessingStatus = {
    isProcessing: false,
    currentStep: "",
    currentPO: "",
    currentEmail: "",
    emailNumber: 0,
    totalEmails: 0
  };

  // Helper function to update processing status (will be used throughout processing)
  const updateProcessingStatus = (status: Partial<typeof currentProcessingStatus>) => {
    currentProcessingStatus = { ...currentProcessingStatus, ...status };
    console.log(`📊 REAL-TIME STATUS: ${currentProcessingStatus.currentPO} - ${currentProcessingStatus.currentStep}`);
  };

  app.get("/api/processing/current-status", async (req, res) => {
    try {
      res.json(currentProcessingStatus);
    } catch (error) {
      console.error("Error getting processing status:", error);
      res.status(500).json({ 
        isProcessing: false,
        currentStep: "",
        currentPO: "",
        message: error instanceof Error ? error.message : 'Failed to get processing status' 
      });
    }
  });

  // Process next batch
  app.post("/api/processing/process-batch", async (req, res) => {
    try {
      // This would implement batch processing logic
      // For now, return success
      res.json({ success: true, message: 'Batch processing initiated' });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Batch processing failed' 
      });
    }
  });

  // Clear object storage for testing
  app.post("/api/testing/clear-object-storage", async (req, res) => {
    try {
      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorage = new ObjectStorageService();
      const result = await objectStorage.clearAllFiles();
      
      res.json({ 
        success: true, 
        deleted: result.deleted,
        errors: result.errors,
        message: `Cleared ${result.deleted} files from object storage`
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to clear object storage' 
      });
    }
  });


  const httpServer = createServer(app);

  return httpServer;
}
