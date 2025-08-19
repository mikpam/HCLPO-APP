import type { Express } from "express";
import { ItemEmbeddingService } from "../services/item-embedding.js";

export function registerItemEmbeddingRoutes(app: Express) {
  const itemEmbeddingService = new ItemEmbeddingService();

  // Get embedding statistics
  app.get("/api/item-embeddings/stats", async (req, res) => {
    try {
      const stats = await itemEmbeddingService.getEmbeddingStats();
      res.json(stats);
    } catch (error) {
      console.error("Error getting item embedding stats:", error);
      res.status(500).json({ 
        error: "Failed to get embedding stats",
        details: (error as Error).message 
      });
    }
  });

  // Generate embeddings for items without embeddings
  app.post("/api/item-embeddings/generate-batch", async (req, res) => {
    try {
      const { limit = 50 } = req.body;
      
      console.log(`🚀 Starting batch item embedding generation (limit: ${limit})`);
      const result = await itemEmbeddingService.generateMissingEmbeddings(limit);
      
      res.json({
        success: true,
        result,
        message: `Generated embeddings for ${result.processed} items`
      });
    } catch (error) {
      console.error("Error in batch embedding generation:", error);
      res.status(500).json({ 
        error: "Failed to generate embeddings",
        details: (error as Error).message 
      });
    }
  });

  // Regenerate embedding for a specific item
  app.post("/api/item-embeddings/regenerate/:itemId", async (req, res) => {
    try {
      const { itemId } = req.params;
      
      await itemEmbeddingService.regenerateItemEmbedding(itemId);
      
      res.json({
        success: true,
        message: `Regenerated embedding for item ${itemId}`
      });
    } catch (error) {
      console.error(`Error regenerating embedding for item ${req.params.itemId}:`, error);
      res.status(500).json({ 
        error: "Failed to regenerate embedding",
        details: (error as Error).message 
      });
    }
  });

  // Test semantic search
  app.post("/api/item-embeddings/test-search", async (req, res) => {
    try {
      const { query, limit = 10 } = req.body;
      
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }
      
      const results = await itemEmbeddingService.testSemanticSearch(query, limit);
      
      res.json({
        success: true,
        query,
        results,
        count: results.length
      });
    } catch (error) {
      console.error("Error in semantic search test:", error);
      res.status(500).json({ 
        error: "Failed to perform semantic search",
        details: (error as Error).message 
      });
    }
  });

  console.log("📊 ITEM EMBEDDING: API routes registered");
}