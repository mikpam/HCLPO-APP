import { contactEmbeddingService } from "./contact-embedding";

/**
 * Continuous Embedding Generation Service
 * Manages background processing of contact embeddings to ensure system stays up-to-date
 */
export class ContinuousEmbeddingService {
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 75; // Conservative batch size to avoid rate limits
  private readonly INTERVAL_MS = 60000; // Process every 60 seconds
  private readonly MIN_DELAY_MS = 5000; // Minimum 5 second delay between batches
  
  /**
   * Start continuous background embedding generation
   */
  async startContinuousGeneration(): Promise<void> {
    if (this.isRunning) {
      console.log("📋 CONTINUOUS EMBEDDINGS: Already running, skipping start");
      return;
    }
    
    this.isRunning = true;
    console.log("🚀 CONTINUOUS EMBEDDINGS: Starting background generation");
    console.log(`   └─ Batch size: ${this.BATCH_SIZE} contacts`);
    console.log(`   └─ Interval: ${this.INTERVAL_MS / 1000} seconds`);
    
    // Process initial batch immediately
    await this.processBatch();
    
    // Set up periodic processing
    this.intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.processBatch();
      }
    }, this.INTERVAL_MS);
  }
  
  /**
   * Stop continuous embedding generation
   */
  stopContinuousGeneration(): void {
    if (!this.isRunning) {
      console.log("📋 CONTINUOUS EMBEDDINGS: Not running, skipping stop");
      return;
    }
    
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    console.log("⏹️ CONTINUOUS EMBEDDINGS: Background generation stopped");
  }
  
  /**
   * Process a single batch of embeddings
   */
  private async processBatch(): Promise<void> {
    try {
      console.log("🔄 CONTINUOUS EMBEDDINGS: Processing batch...");
      
      const startTime = Date.now();
      const processedCount = await contactEmbeddingService.generateMissingEmbeddings(this.BATCH_SIZE);
      const duration = Date.now() - startTime;
      
      if (processedCount > 0) {
        console.log(`   ✅ Processed ${processedCount} contacts in ${Math.round(duration / 1000)}s`);
        
        // Get updated stats
        const stats = await contactEmbeddingService.getEmbeddingStats();
        console.log(`   📊 Progress: ${stats.percentage}% (${stats.withEmbeddings}/${stats.total} contacts)`);
        
        // Add small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, this.MIN_DELAY_MS));
      } else {
        console.log(`   ✅ All contacts have embeddings! Continuing monitoring...`);
      }
    } catch (error) {
      console.error("❌ CONTINUOUS EMBEDDINGS: Batch processing failed:", error);
      // Continue running despite errors - individual batch failures shouldn't stop the service
    }
  }
  
  /**
   * Get current status of continuous generation
   */
  getStatus(): { isRunning: boolean; batchSize: number; intervalMs: number } {
    return {
      isRunning: this.isRunning,
      batchSize: this.BATCH_SIZE,
      intervalMs: this.INTERVAL_MS
    };
  }
  
  /**
   * Get embedding progress stats
   */
  async getProgress(): Promise<any> {
    return await contactEmbeddingService.getEmbeddingStats();
  }
}

// Create singleton instance
export const continuousEmbeddingService = new ContinuousEmbeddingService();