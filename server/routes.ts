import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerCustomerRoutes } from "./routes/customers";
import { gmailService } from "./services/gmail";
import { openaiService } from "./services/openai";
import { aiService, type AIEngine } from "./services/ai-service";
import { airtableService } from "./services/airtable";
import { netsuiteService } from "./services/netsuite";
import { dropboxService } from "./services/dropbox";
import { insertPurchaseOrderSchema, insertErrorLogSchema, classificationResultSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Register customer routes
  registerCustomerRoutes(app);
  
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
        
        // Look for CNumber pattern in subject and body (flexible patterns)
        const cNumberPattern = /(?:Account\s+C|C\s*#?\s*:?\s*)(\d+)/i;
        const subjectMatch = messageToProcess.subject.match(cNumberPattern);
        const bodyMatch = messageToProcess.body.match(cNumberPattern);
        
        if (subjectMatch || bodyMatch) {
          extractedCNumber = subjectMatch?.[1] || bodyMatch?.[1];
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
            
            let processedPO = false;
            
            // Filter and process each PDF attachment
            for (let i = 0; i < pdfAttachments.length && !processedPO; i++) {
              const pdfAttachment = pdfAttachments[i];
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
        
        if (isForwardedEmail && extractionResult?.purchaseOrder?.customer) {
          console.log(`\n📋 FORWARDED EMAIL PROCESSING:`);
          console.log(`   └─ Original sender: ${messageToProcess.sender}`);
          console.log(`   └─ CNumber: ${extractedCNumber}`);
          console.log(`   └─ Using customer from Gemini: ${extractionResult.purchaseOrder.customer.company || extractionResult.purchaseOrder.customer.email || 'Unknown'}`);
          
          // For forwarded emails, use the customer info from Gemini extraction
          customerInfo = extractionResult.purchaseOrder.customer;
          effectiveSenderForPO = customerInfo.email || messageToProcess.sender;
        }

        purchaseOrder = await storage.createPurchaseOrder({
          poNumber,
          emailId: messageToProcess.id,
          sender: effectiveSenderForPO,
          subject: messageToProcess.subject,
          route: processingResult.classification.recommended_route,
          confidence: processingResult.classification.analysis_flags?.confidence_score || 0,
          status: extractionResult ? 'ready_for_netsuite' : 
                  (processingResult.classification.recommended_route === 'TEXT_PO' ? 'ready_for_extraction' : 'pending_review'),
          originalJson: processingResult.classification,
          extractedData: {
            ...extractionResult,
            forwardedEmail: isForwardedEmail ? {
              originalSender: messageToProcess.sender,
              cNumber: extractedCNumber,
              hclCustomerLookup: hclCustomerLookup,
              extractedCustomer: customerInfo || hclCustomerLookup // Use Gemini extraction first, fallback to HCL lookup
            } : undefined
          }
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

  // Email processing
  app.post("/api/emails/process", async (req, res) => {
    try {
      // Fetch emails from Gmail
      const messages = await gmailService.getMessages();
      const processedEmails = [];

      for (const message of messages) {
        try {
          // Check if already processed
          const existingQueue = await storage.getEmailQueueByGmailId(message.id);
          if (existingQueue) {
            continue;
          }

          // Check for forwarded email from @highcaliberline.com and extract CNumber
          let isForwardedEmail = false;
          let extractedCNumber = null;
          
          if (message.sender.includes('@highcaliberline.com')) {
            // Look for CNumber pattern in subject and body (flexible patterns)
            const cNumberPattern = /(?:Account\s+C|C\s*#?\s*:?\s*)(\d+)/i;
            const subjectMatch = message.subject.match(cNumberPattern);
            const bodyMatch = message.body.match(cNumberPattern);
            
            if (subjectMatch || bodyMatch) {
              extractedCNumber = subjectMatch?.[1] || bodyMatch?.[1];
              isForwardedEmail = true;
              console.log(`📨 BULK: Found CNumber ${extractedCNumber} in forwarded email: ${message.subject}`);
            }
          }

          // Create email queue item
          const queueItem = await storage.createEmailQueueItem({
            gmailId: message.id,
            sender: message.sender,
            subject: message.subject,
            body: message.body,
            attachments: message.attachments,
            labels: message.labels,
            status: 'processing'
          });

          // Store PDF attachments for this email
          let storedAttachments = [];
          if (message.attachments.length > 0) {
            storedAttachments = await gmailService.storeEmailAttachments(
              message.id,
              message.attachments
            );
          }

          // Process email using two-step approach (pre-processing + detailed classification)
          const processingResult = await aiService.processEmail({
            sender: message.sender,
            subject: message.subject,
            body: message.body,
            attachments: message.attachments
          });

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

          // Only create purchase order if email passed preprocessing and detailed classification
          if (processingResult.preprocessing.shouldProceed && processingResult.classification && 
              processingResult.classification.recommended_route !== 'REVIEW') {
            const poNumber = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
            
            // Handle forwarded emails for bulk processing
            let effectiveSenderForPO = message.sender;
            let forwardedEmailData = undefined;
            
            if (isForwardedEmail) {
              console.log(`📋 BULK: Processing forwarded email with CNumber ${extractedCNumber}`);
              // For bulk processing, we'll mark for later extraction with proper customer lookup
              effectiveSenderForPO = message.sender; // Keep original for now, will be updated after extraction
              forwardedEmailData = {
                originalSender: message.sender,
                cNumber: extractedCNumber,
                extractedCustomer: null // Will be populated after Gemini extraction
              };
            }
            
            const purchaseOrder = await storage.createPurchaseOrder({
              poNumber,
              emailId: message.id,
              sender: effectiveSenderForPO,
              subject: message.subject,
              route: processingResult.classification.recommended_route,
              confidence: processingResult.classification.analysis_flags?.confidence_score || 0,
              status: processingResult.classification.recommended_route === 'TEXT_PO' ? 'ready_for_extraction' : 'pending_review',
              originalJson: processingResult.classification,
              extractedData: forwardedEmailData ? { forwardedEmail: forwardedEmailData } : undefined
            });

            processedEmails.push({
              email: message,
              preprocessing: processingResult.preprocessing,
              classification: processingResult.classification,
              purchaseOrder
            });
          } else if (!processingResult.preprocessing.shouldProceed) {
            console.log(`Email filtered out: ${processingResult.preprocessing.response} (${processingResult.preprocessing.score})`);
            
            // Add filtered emails to processed list for tracking
            processedEmails.push({
              email: message,
              preprocessing: processingResult.preprocessing,
              classification: null,
              purchaseOrder: null,
              filtered: true
            });
          }

          // Mark as processed in Gmail with preprocessing result
          await gmailService.markAsProcessed(message.id, processingResult.preprocessing);

        } catch (error) {
          console.error(`Error processing email ${message.id}:`, error);
          
          // Log error
          await storage.createErrorLog({
            type: 'Classification Error',
            message: error instanceof Error ? error.message : 'Unknown error',
            relatedPoNumber: message.id,
            resolved: false,
            metadata: { email: message }
          });
        }
      }

      res.json({ 
        processed: processedEmails.length,
        total: messages.length,
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

      // Handle attachment-based PO data extraction using Gemini 2.5 Pro
      if (!poData && order.route === 'ATTACHMENT_PO' && order.originalPdfFilename) {
        const pdfPath = await dropboxService.findPDFByFilename(order.originalPdfFilename);
        if (pdfPath) {
          const pdfBuffer = await dropboxService.downloadFile(pdfPath);
          // Convert PDF to text and extract using Gemini 2.5 Pro
          const pdfText = pdfBuffer.toString('utf-8'); // Simplified - in production use proper PDF parsing
          poData = await aiService.extractPOData('', pdfText);
          await storage.updatePurchaseOrder(order.id, { validatedJson: poData });
        }
      }

      // Find PDF in Dropbox if available
      let pdfData: Buffer | undefined;
      if (order.originalPdfFilename) {
        const pdfPath = await dropboxService.findPDFByFilename(order.originalPdfFilename);
        if (pdfPath) {
          pdfData = await dropboxService.downloadFile(pdfPath);
        }
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
        // Attach PDF if available
        if (pdfData && result.internalId) {
          await netsuiteService.attachPDFToSalesOrder(
            result.internalId, 
            pdfData, 
            order.originalPdfFilename || `${order.poNumber}.pdf`
          );
        }

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

  const httpServer = createServer(app);
  return httpServer;
}
