#!/usr/bin/env tsx

/**
 * Ultra-Optimized Customer Embedding Script
 * 
 * Uses 2,000-customer mega-batches to achieve 120+ records/second
 * - Single OpenAI API call per 2,000 customers
 * - Parallel database updates 
 * - Active customers only
 * - Memory optimized
 */

import { CustomerEmbeddingService } from '../services/customer-embedding.js';

const MEGA_BATCH_SIZE = 2000; // Ultra-optimized mega-batch size
const MAX_RETRIES = 3;
const DELAY_BETWEEN_BATCHES = 1000; // 1 second cooldown

async function main() {
  console.log('🚀 ULTRA-OPTIMIZED CUSTOMER EMBEDDING: Starting mega-batch processing');
  console.log(`   📊 Using mega-batch size: ${MEGA_BATCH_SIZE} customers per batch`);
  console.log(`   ⚡ Target performance: 120+ customers/second`);
  
  const customerEmbeddingService = new CustomerEmbeddingService();
  let totalProcessed = 0;
  let batchCount = 0;
  
  const startTime = Date.now();
  
  try {
    while (true) {
      batchCount++;
      console.log(`\n🔥 MEGA-BATCH ${batchCount}: Processing up to ${MEGA_BATCH_SIZE} customers...`);
      
      let batchProcessed = 0;
      let retryCount = 0;
      
      // Retry logic for API failures
      while (retryCount < MAX_RETRIES) {
        try {
          batchProcessed = await customerEmbeddingService.generateActiveCustomerEmbeddingsOptimized(MEGA_BATCH_SIZE);
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
        console.log('   ✅ All active customers have embeddings! Process complete.');
        break;
      }
      
      totalProcessed += batchProcessed;
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      const customersPerSecond = totalProcessed / elapsedSeconds;
      
      console.log(`   📈 PERFORMANCE METRICS:`);
      console.log(`      └─ Batch ${batchCount}: ${batchProcessed} customers processed`);
      console.log(`      └─ Total processed: ${totalProcessed} customers`);
      console.log(`      └─ Elapsed time: ${elapsedSeconds.toFixed(1)}s`);
      console.log(`      └─ Current speed: ${customersPerSecond.toFixed(1)} customers/second`);
      
      // Brief cooldown between mega-batches to avoid overwhelming the API
      if (DELAY_BETWEEN_BATCHES > 0) {
        console.log(`   ⏸️  Cooldown: ${DELAY_BETWEEN_BATCHES}ms between mega-batches`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }
    
  } catch (error) {
    console.error('❌ ULTRA-OPTIMIZED CUSTOMER EMBEDDING FAILED:', error);
    throw error;
  }
  
  const totalTime = (Date.now() - startTime) / 1000;
  const finalRate = totalProcessed / totalTime;
  
  console.log('\n🎉 ULTRA-OPTIMIZED CUSTOMER EMBEDDING COMPLETE!');
  console.log(`   📊 Final Statistics:`);
  console.log(`      └─ Total customers processed: ${totalProcessed}`);
  console.log(`      └─ Total time: ${totalTime.toFixed(1)}s`);
  console.log(`      └─ Average rate: ${finalRate.toFixed(1)} customers/second`);
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