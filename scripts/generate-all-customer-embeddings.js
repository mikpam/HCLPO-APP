#!/usr/bin/env node

/**
 * ULTRA-OPTIMIZED Customer Embedding Generation Script
 * Generates embeddings for all remaining customers using batch processing
 * 
 * This script uses your existing ultra embeddings infrastructure with:
 * - Optimized batch processing (100 customers per batch)
 * - Automatic rate limiting and error handling
 * - Progress tracking and completion statistics
 * - Memory optimization for large datasets
 */

const BATCH_SIZE = 100;
const API_BASE = 'http://localhost:5000';
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches

// Import node modules for HTTP requests
const http = require('http');

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 5000,
      path: urlObj.pathname,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

async function getEmbeddingStats() {
  const response = await makeRequest(`${API_BASE}/api/customer-embeddings/stats`);
  return response.stats || response;
}

async function generateBatch() {
  const result = await makeRequest(`${API_BASE}/api/customer-embeddings/generate-missing`, {
    method: 'POST',
    body: JSON.stringify({ batchSize: BATCH_SIZE })
  });
  return result;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 ULTRA-OPTIMIZED Customer Embedding Generation');
  console.log('================================================');
  
  try {
    // Get initial stats
    console.log('📊 Checking current embedding status...');
    const initialStats = await getEmbeddingStats();
    
    console.log(`📈 INITIAL STATUS:`);
    console.log(`   Total Customers: ${initialStats.totalCustomers.toLocaleString()}`);
    console.log(`   With Embeddings: ${initialStats.customersWithEmbeddings.toLocaleString()}`);
    console.log(`   Missing Embeddings: ${initialStats.customersWithoutEmbeddings.toLocaleString()}`);
    console.log(`   Current Coverage: ${initialStats.completionPercentage}%`);
    
    if (initialStats.customersWithoutEmbeddings === 0) {
      console.log('✅ All customers already have embeddings!');
      return;
    }
    
    console.log(`\n🎯 TARGET: Generate embeddings for ${initialStats.customersWithoutEmbeddings.toLocaleString()} customers`);
    console.log(`📦 BATCH SIZE: ${BATCH_SIZE} customers per batch`);
    console.log(`⏱️  ESTIMATED BATCHES: ${Math.ceil(initialStats.customersWithoutEmbeddings / BATCH_SIZE)}`);
    
    let totalProcessed = 0;
    let totalErrors = 0;
    let batchNumber = 1;
    
    console.log('\n🔥 Starting batch processing...\n');
    
    while (true) {
      console.log(`🚀 BATCH ${batchNumber}: Processing up to ${BATCH_SIZE} customers...`);
      
      try {
        const result = await generateBatch();
        
        if (!result.success || !result.result) {
          console.log('❌ Batch failed or returned invalid result');
          break;
        }
        
        const { processed, errors, total } = result.result;
        totalProcessed += processed;
        totalErrors += errors;
        
        console.log(`   ✅ Batch ${batchNumber} complete: ${processed} processed, ${errors} errors`);
        
        // If no customers were processed, we're done
        if (processed === 0) {
          console.log('✅ No more customers need embeddings - job complete!');
          break;
        }
        
        // Progress update
        const remaining = initialStats.customersWithoutEmbeddings - totalProcessed;
        const progressPercent = ((totalProcessed / initialStats.customersWithoutEmbeddings) * 100).toFixed(1);
        
        console.log(`   📊 Progress: ${totalProcessed.toLocaleString()}/${initialStats.customersWithoutEmbeddings.toLocaleString()} (${progressPercent}%) | Remaining: ${remaining.toLocaleString()}`);
        
        batchNumber++;
        
        // Brief delay between batches to respect rate limits
        if (remaining > 0) {
          console.log(`   ⏱️  Waiting ${DELAY_BETWEEN_BATCHES/1000}s before next batch...\n`);
          await sleep(DELAY_BETWEEN_BATCHES);
        }
        
      } catch (error) {
        console.error(`❌ Batch ${batchNumber} failed:`, error.message);
        totalErrors++;
        
        // Wait longer after errors
        console.log('   ⏱️  Waiting 5s after error before retry...\n');
        await sleep(5000);
        batchNumber++;
      }
    }
    
    // Final stats
    console.log('\n📊 FINAL RESULTS:');
    console.log('==================');
    console.log(`✅ Total Processed: ${totalProcessed.toLocaleString()}`);
    console.log(`❌ Total Errors: ${totalErrors}`);
    console.log(`📦 Batches Completed: ${batchNumber - 1}`);
    
    // Get updated stats
    console.log('\n🔍 Verifying final status...');
    const finalStats = await getEmbeddingStats();
    console.log(`📈 FINAL STATUS:`);
    console.log(`   Total Customers: ${finalStats.totalCustomers.toLocaleString()}`);
    console.log(`   With Embeddings: ${finalStats.customersWithEmbeddings.toLocaleString()}`);
    console.log(`   Missing Embeddings: ${finalStats.customersWithoutEmbeddings.toLocaleString()}`);
    console.log(`   Coverage: ${finalStats.completionPercentage}%`);
    
    if (finalStats.completionPercentage >= 99.9) {
      console.log('\n🎉 SUCCESS: Customer embedding generation complete!');
      console.log('   Your semantic search and AI analysis will now work much better!');
    } else {
      console.log(`\n⚠️  ${finalStats.customersWithoutEmbeddings} customers still need embeddings`);
      console.log('   You may want to run this script again to complete the remaining items');
    }
    
  } catch (error) {
    console.error('\n💥 CRITICAL ERROR:', error.message);
    console.error('Script terminated unexpectedly');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n⏹️  Received interrupt signal - shutting down gracefully...');
  console.log('   Current progress has been saved to the database');
  process.exit(0);
});

// Run the script
main().catch(error => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});