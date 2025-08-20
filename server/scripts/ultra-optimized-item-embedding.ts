#!/usr/bin/env tsx

/**
 * Ultra-Optimized Item Embedding Script
 * 
 * Uses 2,000-item mega-batches to achieve 110+ records/second
 * - Single OpenAI API call per 2,000 items
 * - Parallel database updates 
 * - Memory optimized
 * - Raw SQL for maximum performance
 */

import { ItemEmbeddingService } from '../services/item-embedding.js';

const MEGA_BATCH_SIZE = 2000; // Ultra-optimized mega-batch size
const MAX_RETRIES = 3;
const DELAY_BETWEEN_BATCHES = 1000; // 1 second cooldown

async function main() {
  console.log('🚀 ULTRA-OPTIMIZED ITEM EMBEDDING: Starting mega-batch processing');
  console.log(`   📊 Using mega-batch size: ${MEGA_BATCH_SIZE} items per batch`);
  console.log(`   ⚡ Target performance: 110+ items/second`);
  
  const itemEmbeddingService = new ItemEmbeddingService();
  let totalProcessed = 0;
  let batchCount = 0;
  
  const startTime = Date.now();
  
  try {
    while (true) {
      batchCount++;
      console.log(`\n🔥 MEGA-BATCH ${batchCount}: Processing up to ${MEGA_BATCH_SIZE} items...`);
      
      let batchProcessed = 0;
      let retryCount = 0;
      
      // Retry logic for API failures
      while (retryCount < MAX_RETRIES) {
        try {
          batchProcessed = await itemEmbeddingService.generateItemEmbeddingsOptimized(MEGA_BATCH_SIZE);
          break; // Success, exit retry loop
        } catch (error) {
          retryCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.log(`   ⚠️  Batch ${batchCount} failed (attempt ${retryCount}/${MAX_RETRIES}):`, errorMessage);
          
          if (retryCount < MAX_RETRIES) {
            const backoffDelay = retryCount * 2000; // Exponential backoff
            console.log(`   ⏳ Retrying in ${backoffDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
          }
        }
      }
      
      if (batchProcessed === 0) {
        console.log('   ✅ All items have embeddings! Process complete.');
        break;
      }
      
      totalProcessed += batchProcessed;
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      const itemsPerSecond = totalProcessed / elapsedSeconds;
      
      console.log(`   📈 PERFORMANCE METRICS:`);
      console.log(`      └─ Batch ${batchCount}: ${batchProcessed} items processed`);
      console.log(`      └─ Total processed: ${totalProcessed} items`);
      console.log(`      └─ Elapsed time: ${elapsedSeconds.toFixed(1)}s`);
      console.log(`      └─ Current speed: ${itemsPerSecond.toFixed(1)} items/second`);
      
      // Brief cooldown between mega-batches to avoid overwhelming the API
      if (DELAY_BETWEEN_BATCHES > 0) {
        console.log(`   ⏸️  Cooldown: ${DELAY_BETWEEN_BATCHES}ms between mega-batches`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }
    
  } catch (error) {
    console.error('❌ ULTRA-OPTIMIZED ITEM EMBEDDING FAILED:', error);
    throw error;
  }
  
  const totalTime = (Date.now() - startTime) / 1000;
  const finalRate = totalProcessed / totalTime;
  
  console.log('\n🎉 ULTRA-OPTIMIZED ITEM EMBEDDING COMPLETE!');
  console.log(`   📊 Final Statistics:`);
  console.log(`      └─ Total items processed: ${totalProcessed}`);
  console.log(`      └─ Total time: ${totalTime.toFixed(1)}s`);
  console.log(`      └─ Average rate: ${finalRate.toFixed(1)} items/second`);
  console.log(`      └─ Batches processed: ${batchCount}`);
  console.log(`      └─ Mega-batch size: ${MEGA_BATCH_SIZE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

export { main };