import type { Express } from "express";
import { customerEmbeddingService } from "../services/customer-embedding";
import { hybridCustomerValidator } from "../services/hybrid-customer-validator";

export function registerCustomerEmbeddingRoutes(app: Express) {
  console.log("📡 Registering customer embedding management routes");

  /**
   * Generate missing customer embeddings
   * POST /api/customer-embeddings/generate-missing
   */
  app.post("/api/customer-embeddings/generate-missing", async (req, res) => {
    try {
      const { batchSize = 50 } = req.body;
      const result = await customerEmbeddingService.generateMissingEmbeddings(batchSize);
      
      res.json({
        success: true,
        message: `Generated embeddings for ${result.processed} customers`,
        result
      });
    } catch (error) {
      console.error("Error generating customer embeddings:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * Get customer embedding statistics
   * GET /api/customer-embeddings/stats
   */
  app.get("/api/customer-embeddings/stats", async (req, res) => {
    try {
      const stats = await customerEmbeddingService.getEmbeddingStats();
      res.json({
        success: true,
        stats
      });
    } catch (error) {
      console.error("Error getting customer embedding stats:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * Generate embedding for specific customer
   * POST /api/customer-embeddings/generate/:customerId
   */
  app.post("/api/customer-embeddings/generate/:customerId", async (req, res) => {
    try {
      const { customerId } = req.params;
      const success = await customerEmbeddingService.generateCustomerEmbedding(customerId);
      
      if (success) {
        res.json({
          success: true,
          message: `Generated embedding for customer ${customerId}`
        });
      } else {
        res.status(400).json({
          success: false,
          error: "Failed to generate embedding"
        });
      }
    } catch (error) {
      console.error("Error generating customer embedding:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * Test hybrid customer validation
   * POST /api/customer-embeddings/test-validation
   */
  app.post("/api/customer-embeddings/test-validation", async (req, res) => {
    try {
      const {
        customerName,
        customerEmail,
        senderEmail,
        contactName,
        phoneDigits,
        address,
        netsuiteId,
        customerNumber
      } = req.body;

      const result = await hybridCustomerValidator.validateCustomer({
        customerName,
        customerEmail,
        senderEmail,
        contactName,
        phoneDigits,
        address,
        netsuiteId,
        customerNumber
      });

      res.json({
        success: true,
        result
      });
    } catch (error) {
      console.error("Error testing customer validation:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  console.log("✅ Customer embedding routes registered successfully");
}