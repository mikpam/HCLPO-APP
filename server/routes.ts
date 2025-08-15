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
              confidence: processingResult.classification.analysis_flags.confidence_score,
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
      // Test Gmail connection by fetching a single message
      const messages = await gmailService.getMessages('label:inbox');
      res.json({ 
        success: true, 
        connection: 'working',
        message: `Successfully connected to Gmail. Found ${messages.length} messages in inbox.`,
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
