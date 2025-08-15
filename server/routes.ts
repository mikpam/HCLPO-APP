import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { gmailService } from "./services/gmail";
import { openaiService } from "./services/openai";
import { aiService, type AIEngine } from "./services/ai-service";
import { airtableService } from "./services/airtable";
import { netsuiteService } from "./services/netsuite";
import { dropboxService } from "./services/dropbox";
import { insertPurchaseOrderSchema, insertErrorLogSchema, classificationResultSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  
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

      console.log(`Processing single email: ${messageToProcess.subject}`);

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
      const processingResult = await aiService.processEmail({
        sender: messageToProcess.sender,
        subject: messageToProcess.subject,
        body: messageToProcess.body,
        attachments: messageToProcess.attachments
      });

      // Update queue item with results
      const updateData: any = {
        preprocessingResult: processingResult.preprocessing,
        status: processingResult.preprocessing.shouldProceed ? 'processed' : 'filtered',
        processedAt: new Date()
      };

      if (processingResult.classification) {
        updateData.classificationResult = processingResult.classification;
      }

      await storage.updateEmailQueueItem(queueItem.id, updateData);

      let purchaseOrder = null;
      let attachmentPaths: string[] = [];

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
        const poNumber = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
        
        purchaseOrder = await storage.createPurchaseOrder({
          poNumber,
          emailId: messageToProcess.id,
          sender: messageToProcess.sender,
          subject: messageToProcess.subject,
          route: processingResult.classification.recommended_route,
          confidence: processingResult.classification.analysis_flags?.confidence_score || 0,
          status: processingResult.classification.recommended_route === 'TEXT_PO' ? 'ready_for_extraction' : 'pending_review',
          originalJson: processingResult.classification
        });
      }

      // Mark as processed in Gmail
      await gmailService.markAsProcessed(messageToProcess.id);

      res.json({ 
        message: `Successfully processed: ${messageToProcess.subject}`,
        processed: 1,
        details: {
          emailId: messageToProcess.id,
          sender: messageToProcess.sender,
          subject: messageToProcess.subject,
          preprocessing: {
            classification: processingResult.preprocessing.response,
            confidence: processingResult.preprocessing.score ? Math.round(processingResult.preprocessing.score * 100) : null,
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
            status: purchaseOrder.status
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

          // Update queue item with both preprocessing and classification results
          const updateData: any = {
            preprocessingResult: processingResult.preprocessing,
            status: processingResult.preprocessing.shouldProceed ? 'processed' : 'filtered',
            processedAt: new Date()
          };

          if (processingResult.classification) {
            updateData.classificationResult = processingResult.classification;
          }

          await storage.updateEmailQueueItem(queueItem.id, updateData);

          // Only create purchase order if email passed preprocessing and detailed classification
          if (processingResult.preprocessing.shouldProceed && processingResult.classification && 
              processingResult.classification.recommended_route !== 'REVIEW') {
            const poNumber = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
            
            const purchaseOrder = await storage.createPurchaseOrder({
              poNumber,
              emailId: message.id,
              sender: message.sender,
              subject: message.subject,
              route: processingResult.classification.recommended_route,
              confidence: processingResult.classification.analysis_flags?.confidence_score || 0,
              status: processingResult.classification.recommended_route === 'TEXT_PO' ? 'ready_for_extraction' : 'pending_review',
              originalJson: processingResult.classification
            });

            processedEmails.push({
              email: message,
              preprocessing: processingResult.preprocessing,
              classification: processingResult.classification,
              purchaseOrder
            });
          } else if (!processingResult.preprocessing.shouldProceed) {
            console.log(`Email filtered out: ${processingResult.preprocessing.response} (${processingResult.preprocessing.score})`);
          }

          // Mark as processed in Gmail
          await gmailService.markAsProcessed(message.id);

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
        account: 'hclpurchaseorders@metrixdigital.com',
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
