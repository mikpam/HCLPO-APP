#!/usr/bin/env tsx
import { CustomerEmbeddingService } from "../server/services/customer-embedding";
import { db } from "../server/db";
import { customers } from "../shared/schema";
import { isNull } from "drizzle-orm";

async function generateAllCustomerEmbeddings() {
  console.log("🚀 Starting customer embedding generation...");
  
  const embeddingService = new CustomerEmbeddingService();
  
  // Check total customers needing embeddings
  const totalNeeded = await db
    .select({ count: customers.id })
    .from(customers)
    .where(isNull(customers.customerEmbedding));
    
  console.log(`📊 Total customers needing embeddings: ${totalNeeded.length}`);
  
  let totalProcessed = 0;
  let totalErrors = 0;
  const batchSize = 100; // Process 100 at a time
  
  // Keep processing until all are done
  while (true) {
    const result = await embeddingService.generateMissingEmbeddings(batchSize);
    
    totalProcessed += result.processed;
    totalErrors += result.errors;
    
    console.log(`   ✅ Batch complete: ${result.processed} processed, ${result.errors} errors`);
    console.log(`   📈 Total progress: ${totalProcessed} processed, ${totalErrors} errors`);
    
    // If no more to process, we're done
    if (result.processed === 0) {
      break;
    }
    
    // Small delay between batches to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log("\n✨ Embedding generation complete!");
  console.log(`   ✅ Successfully processed: ${totalProcessed}`);
  console.log(`   ❌ Errors: ${totalErrors}`);
  
  // Verify final status
  const remaining = await db
    .select({ count: customers.id })
    .from(customers)
    .where(isNull(customers.customerEmbedding));
    
  console.log(`   📊 Remaining without embeddings: ${remaining.length}`);
  
  process.exit(0);
}

// Run the script
generateAllCustomerEmbeddings().catch(error => {
  console.error("❌ Error generating embeddings:", error);
  process.exit(1);
});