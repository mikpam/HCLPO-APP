import type { Express } from "express";
import { ContactEmbeddingService } from "../services/contact-embedding";
import { hybridContactSearchService } from "../services/hybrid-contact-search";

const contactEmbeddingService = new ContactEmbeddingService();

export function registerContactEmbeddingRoutes(app: Express) {
  console.log("📡 Registering contact embedding management routes");

  // Get embedding statistics
  app.get("/api/contact-embeddings/stats", async (req, res) => {
    try {
      const stats = await contactEmbeddingService.getEmbeddingStats();
      res.json(stats);
    } catch (error) {
      console.error("Error getting embedding stats:", error);
      res.status(500).json({ 
        error: "Failed to get embedding statistics",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Check embedding health
  app.get("/api/contact-embeddings/health", async (req, res) => {
    try {
      const health = await hybridContactSearchService.checkEmbeddingHealth();
      res.json(health);
    } catch (error) {
      console.error("Error checking embedding health:", error);
      res.status(500).json({ 
        error: "Failed to check embedding health",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Generate missing embeddings (ULTRA-OPTIMIZED batch processing)
  app.post("/api/contact-embeddings/generate-missing", async (req, res) => {
    try {
      const { batchSize = 100, optimized = true } = req.body;
      
      console.log(`🚀 API: Starting missing embeddings generation (batch size: ${batchSize}, optimized: ${optimized})`);
      
      const processedCount = optimized 
        ? await contactEmbeddingService.generateMissingEmbeddingsOptimized(batchSize)
        : await contactEmbeddingService.generateMissingEmbeddings(batchSize);
      
      const stats = await contactEmbeddingService.getEmbeddingStats();
      
      res.json({
        success: true,
        processedCount,
        message: `Successfully processed ${processedCount} contacts using ${optimized ? 'OPTIMIZED' : 'standard'} batch processing`,
        stats
      });
    } catch (error) {
      console.error("Error generating missing embeddings:", error);
      res.status(500).json({ 
        error: "Failed to generate missing embeddings",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Regenerate all embeddings (full rebuild)
  app.post("/api/contact-embeddings/regenerate-all", async (req, res) => {
    try {
      const { batchSize = 25 } = req.body;
      
      console.log(`🔄 API: Starting full embeddings regeneration (batch size: ${batchSize})`);
      const processedCount = await contactEmbeddingService.regenerateAllEmbeddings(batchSize);
      
      const stats = await contactEmbeddingService.getEmbeddingStats();
      
      res.json({
        success: true,
        processedCount,
        message: `Successfully regenerated embeddings for ${processedCount} contacts`,
        stats
      });
    } catch (error) {
      console.error("Error regenerating all embeddings:", error);
      res.status(500).json({ 
        error: "Failed to regenerate all embeddings",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Update embedding for a specific contact
  app.post("/api/contact-embeddings/update/:contactId", async (req, res) => {
    try {
      const { contactId } = req.params;
      
      console.log(`🔄 API: Updating embedding for contact: ${contactId}`);
      await contactEmbeddingService.updateContactEmbedding(contactId);
      
      res.json({
        success: true,
        message: `Successfully updated embedding for contact ${contactId}`
      });
    } catch (error) {
      console.error(`Error updating embedding for contact ${req.params.contactId}:`, error);
      res.status(500).json({ 
        error: "Failed to update contact embedding",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Test hybrid contact search
  app.post("/api/contact-embeddings/test-search", async (req, res) => {
    try {
      const { name, email, jobTitle, phone, company } = req.body;
      
      if (!name && !email && !jobTitle && !phone && !company) {
        return res.status(400).json({
          error: "At least one search parameter is required",
          required: ["name", "email", "jobTitle", "phone", "company"]
        });
      }
      
      console.log(`🔍 API: Testing hybrid contact search with:`, req.body);
      const result = await hybridContactSearchService.searchContact({
        name,
        email,
        jobTitle,
        phone,
        company
      });
      
      res.json({
        success: true,
        result
      });
    } catch (error) {
      console.error("Error testing hybrid contact search:", error);
      res.status(500).json({ 
        error: "Failed to test hybrid contact search",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  console.log("✅ Contact embedding routes registered successfully");
}