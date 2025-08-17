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
import { skuValidator } from "./services/openai-sku-validator";

import { insertPurchaseOrderSchema, insertErrorLogSchema, classificationResultSchema } from "@shared/schema";
import { z } from "zod";

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
  
  // Test endpoint for Gmail labels
  app.post("/api/test/gmail-labels", async (req, res) => {
    try {
      await gmailService.ensureLabelsExist();
      res.json({ message: "Gmail labels created/verified successfully" });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to manage Gmail labels' 
      });
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

  // Bulk email processing endpoint

  // Process single email for development
  app.post("/api/emails/process-single", async (req, res) => {
    try {
      // Fetch emails from Gmail
      const messages = await gmailService.getMessages();
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
                const filterResult = await geminiService.filterDocumentType(pdfAttachment.buffer!, pdfAttachment.filename);
                
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
            const { contactFinderService } = await import('./services/contact-finder');
            const contactMatch = await contactFinderService.findContact({
              name: extractionResult.purchaseOrder.contact.name,
              email: extractionResult.purchaseOrder.contact.email,
              phone: extractionResult.purchaseOrder.contact.phone,
              jobTitle: extractionResult.purchaseOrder.contact.jobTitle
            });
            
            if (contactMatch) {
              contactMeta = contactMatch;
              console.log(`   ✅ Contact found in HCL database: ${contactMatch.name} (${contactMatch.netsuite_internal_id})`);
            } else {
              console.log(`   ℹ️  Contact not found in HCL database (will use extracted info)`);
            }
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
        let validatedLineItems = null;
        if (extractionResult?.lineItems?.length > 0) {
          console.log(`\n🤖 OPENAI SKU VALIDATOR: Processing ${extractionResult.lineItems.length} extracted line items...`);
          
          try {
            const { skuValidator } = await import('./services/openai-sku-validator');
            
            // Format line items for SKU validator (____-separated format)
            const lineItemsForValidation = extractionResult.lineItems
              .map(item => {
                return `sku: ${item.sku || ''}
description: ${item.description || ''}
itemColor: ${item.itemColor || ''}
quantity: ${item.quantity || 1}
unitPrice: ${item.unitPrice || 0}
totalPrice: ${item.totalPrice || 0}`;
              })
              .join('\n____\n');
            
            console.log(`   └─ Formatted ${extractionResult.lineItems.length} line items for validation`);
            
            // Validate line items with OpenAI
            validatedLineItems = await skuValidator.validateLineItems(lineItemsForValidation);
            
            console.log(`   ✅ SKU validation complete: ${validatedLineItems.length} items processed`);
            validatedLineItems.forEach((item, index) => {
              const original = extractionResult.lineItems[index];
              if (original?.sku !== item.finalSKU) {
                console.log(`      ${index + 1}. "${original?.sku || item.sku}" → "${item.finalSKU}"`);
              }
            });
            
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
            // Override line items with validated ones if available
            lineItems: validatedLineItems || extractionResult?.lineItems || [],
            forwardedEmail: isForwardedEmail ? {
              originalSender: messageToProcess.sender,
              cNumber: extractedCNumber,
              hclCustomerLookup: hclCustomerLookup,
              extractedCustomer: customerInfo || hclCustomerLookup // Use Gemini extraction first, fallback to HCL lookup
            } : undefined
          },
          lineItems: validatedLineItems || extractionResult?.lineItems || [], // Store validated line items in main lineItems field
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
      
      // First, count how many unprocessed emails exist
      const allMessages = await gmailService.getMessages();
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
        // Fetch one unprocessed email
        const messages = await gmailService.getMessages();
        
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
          const gmailMessage = await gmailService.getMessageDetails(messageToProcess.id);
          
          if (!gmailMessage) {
            console.error(`❌ Could not fetch Gmail message details for ${messageToProcess.id}`);
            throw new Error("Failed to fetch message details");
          }

          console.log(`   └─ Attachments: ${gmailMessage.attachments?.length || 0}`);

          // Create email queue entry with processing status
          const emailQueue = await storage.createEmailQueue({
            gmailId: messageToProcess.id,
            sender: gmailMessage.sender,
            recipient: gmailMessage.recipient || "",
            subject: gmailMessage.subject || "",
            body: gmailMessage.body || "",
            receivedAt: gmailMessage.receivedAt,
            status: "processing",
            classification: null,
            extractedData: null,
            processingSteps: null,
            attachments: gmailMessage.attachments || []
          });

          // Store attachments first
          if (gmailMessage.attachments && gmailMessage.attachments.length > 0) {
            console.log(`📎 ATTACHMENT ANALYSIS: Found ${gmailMessage.attachments.length} total attachments`);
            
            for (const attachment of gmailMessage.attachments) {
              try {
                if (attachment.data) {
                  const objectStorageService = new ObjectStorageService();
                  
                  // Store attachment
                  const cleanFilename = sanitizeFilename(attachment.filename);
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
            await gmailService.preserveEmail(messageToProcess.id, gmailMessage);
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
          const preprocessing = await openaiService.preprocessEmail(gmailMessage);
          console.log(`📊 EMAIL SIZE: Original body ${gmailMessage.body?.length || 0} chars, truncated to ${preprocessing.emailBody?.length || 0} chars`);
          console.log(`   └─ Pre-processing: ${preprocessing.classification} (Continue: ${preprocessing.shouldProceed})`);

          // Step 2: If pre-processing says proceed, do detailed analysis
          let classification = null;
          if (preprocessing.shouldProceed) {
            classification = await openaiService.classifyEmailDetails(gmailMessage, preprocessing);
            console.log(`   └─ Detailed route: ${classification.route} (${Math.round(classification.confidence)}%)`);
          }

          // Generate PO number
          console.log(`📋 PO NUMBER ASSIGNMENT:`);
          const poNumber = generatePONumber();
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
                const prioritizedAttachment = prioritizeAttachments(gmailMessage.attachments)[0];
                
                if (prioritizedAttachment) {
                  console.log(`   └─ Processing prioritized attachment: ${prioritizedAttachment.filename}`);
                  
                  if (prioritizedAttachment.data) {
                    const extractedData = await geminiService.extractPOFromDocument(
                      prioritizedAttachment.data,
                      prioritizedAttachment.mimeType,
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
              
              const extractedData = await geminiService.extractPOFromText(
                gmailMessage.body || "",
                gmailMessage.sender,
                gmailMessage.subject || ""
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

            const updatedPO = await openaiCustomerFinder.processPurchaseOrder(purchaseOrder.id);
            
            console.log(`   ✅ Updated purchase order ${poNumber} (Status: ${updatedPO?.status || 'unknown'})`);
          }

          // Update Gmail labels
          console.log(`Updating Gmail labels for message ${messageToProcess.id}`);
          
          const classificationLabel = preprocessing.classification.toLowerCase().replace(/\s+/g, '-');
          const aiLabelName = `ai-${classificationLabel}`;
          
          console.log(`   └─ Adding '${aiLabelName}' label (AI classification: ${preprocessing.classification})`);
          console.log(`   └─ Adding 'processed' label (passed preprocessing: ${preprocessing.classification})`);
          
          try {
            await gmailService.updateLabels(messageToProcess.id, [aiLabelName, 'processed']);
            console.log(`   ✅ Successfully updated Gmail labels`);
          } catch (error) {
            console.error(`   ❌ Failed to update Gmail labels:`, error);
          }

          // Update email queue status
          await storage.updateEmailQueue(emailQueue.id, {
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

  // Email processing - Sequential processing like single email but iterate through all
  app.post("/api/emails/process", async (req, res) => {
    try {
      console.log(`🔄 NORMAL PROCESSING: Starting sequential email processing...`);
      
      // First, count how many unprocessed emails exist
      const allMessages = await gmailService.getMessages();
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
        // Fetch one unprocessed email
        const messages = await gmailService.getMessages();
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
            const { emailId } = await gmailService.preserveEmail(messageToProcess.id);
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

                  // Extract and process contact information
                  let contactData = null;
                  if (extractionResult.purchaseOrder?.contact) {
                    console.log(`👤 CONTACT EXTRACTION:`);
                    console.log(`   └─ Contact Name: ${extractionResult.purchaseOrder.contact.name}`);
                    console.log(`   └─ Contact Email: ${extractionResult.purchaseOrder.contact.email}`);
                    console.log(`   └─ Contact Phone: ${extractionResult.purchaseOrder.contact.phone}`);
                    console.log(`   └─ Job Title: ${extractionResult.purchaseOrder.contact.jobTitle}`);
                    contactData = extractionResult.purchaseOrder.contact;
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

                  // SKU validation with OpenAI
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
                    
                    validatedItems = await skuValidator.validateLineItems(lineItemsForValidation);
                    console.log(`   ✅ SKU validation complete: ${validatedItems.length} items processed`);
                    
                    // Log validation results
                    validatedItems.forEach((item: any, index: number) => {
                      const original = extractionResult.lineItems[index];
                      if (original?.sku !== item.finalSKU) {
                        console.log(`      ${index + 1}. "${original?.sku || item.sku}" → "${item.finalSKU}"`);
                      }
                    });
                  }

                  // Determine final status
                  const finalStatus = !finalCustomerData ? 'new_customer' : 'ready_for_netsuite';

                  // Update purchase order with all extracted data using same structure as single processing
                  await storage.updatePurchaseOrder(purchaseOrder.id, {
                    extractedData: extractionResult,
                    customerMeta: finalCustomerData,
                    status: finalStatus,
                    lineItems: validatedItems || extractionResult?.lineItems || [],
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
      const finalMessages = await gmailService.getMessages();
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
      const [classification, importReady, pendingReview, errors] = await Promise.all([
        storage.getEmailQueue({ status: 'pending', limit: 100 }),
        storage.getPurchaseOrders({ status: 'ready for NS import', limit: 100 }),
        storage.getPurchaseOrders({ status: 'pending_review', limit: 100 }),
        storage.getErrorLogs({ resolved: false, limit: 100 })
      ]);

      res.json({
        classification: classification.length,
        import: importReady.length,
        review: pendingReview.length,
        errors: errors.length
      });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to fetch queue status' 
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
