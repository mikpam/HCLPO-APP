#!/usr/bin/env tsx
import { db } from "../server/db";
import { customers } from "../shared/schema";
import { isNull, sql } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function ultraEmbedCustomers() {
  console.log("🚀 ULTRA EMBEDDING: Starting high-speed customer embedding generation...");
  
  // Get ALL customers without embeddings
  const customersNeedingEmbeddings = await db
    .select({
      id: customers.id,
      customerNumber: customers.customerNumber,
      companyName: customers.companyName,
      email: customers.email,
      phone: customers.phone,
    })
    .from(customers)
    .where(isNull(customers.customerEmbedding));
    
  console.log(`📊 Found ${customersNeedingEmbeddings.length} customers needing embeddings`);
  
  if (customersNeedingEmbeddings.length === 0) {
    console.log("✅ All customers already have embeddings!");
    process.exit(0);
  }
  
  const BATCH_SIZE = 500; // Process 500 at once for ultra speed
  const CONCURRENT_BATCHES = 5; // Run 5 batches in parallel
  let totalProcessed = 0;
  let totalErrors = 0;
  
  // Process in ultra-large batches
  for (let i = 0; i < customersNeedingEmbeddings.length; i += BATCH_SIZE * CONCURRENT_BATCHES) {
    const megaBatch = customersNeedingEmbeddings.slice(i, i + BATCH_SIZE * CONCURRENT_BATCHES);
    
    // Split into concurrent batches
    const batches = [];
    for (let j = 0; j < megaBatch.length; j += BATCH_SIZE) {
      batches.push(megaBatch.slice(j, j + BATCH_SIZE));
    }
    
    console.log(`\n⚡ Processing mega-batch: ${i} to ${Math.min(i + BATCH_SIZE * CONCURRENT_BATCHES, customersNeedingEmbeddings.length)}`);
    
    // Process all batches in parallel
    const batchPromises = batches.map(async (batch, batchIndex) => {
      try {
        // Create text for all customers in this batch
        const texts = batch.map(customer => {
          const parts = [
            customer.companyName,
            customer.customerNumber,
            customer.email || '',
            customer.phone || ''
          ].filter(Boolean);
          return parts.join(' | ');
        });
        
        console.log(`   📦 Batch ${batchIndex + 1}: Generating ${texts.length} embeddings...`);
        
        // Generate all embeddings in one API call
        const response = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: texts
        });
        
        // Update database in parallel
        const updatePromises = batch.map(async (customer, idx) => {
          const embedding = response.data[idx].embedding;
          const embeddingString = `[${embedding.join(',')}]`;
          
          await db
            .update(customers)
            .set({ 
              customerEmbedding: sql`${embeddingString}::vector`,
              updatedAt: new Date()
            })
            .where(sql`id = ${customer.id}`);
            
          return customer.customerNumber;
        });
        
        const processed = await Promise.all(updatePromises);
        console.log(`   ✅ Batch ${batchIndex + 1}: ${processed.length} customers embedded`);
        return processed.length;
        
      } catch (error) {
        console.error(`   ❌ Batch ${batchIndex + 1} error:`, error.message);
        return 0;
      }
    });
    
    const results = await Promise.all(batchPromises);
    const batchProcessed = results.reduce((sum, count) => sum + count, 0);
    totalProcessed += batchProcessed;
    
    console.log(`   ⚡ Mega-batch complete: ${batchProcessed} customers processed`);
    console.log(`   📈 Total progress: ${totalProcessed}/${customersNeedingEmbeddings.length} (${Math.round(totalProcessed/customersNeedingEmbeddings.length*100)}%)`);
    
    // Small delay between mega-batches to avoid rate limits
    if (i + BATCH_SIZE * CONCURRENT_BATCHES < customersNeedingEmbeddings.length) {
      console.log(`   ⏳ Cooling down for 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Final verification
  const remaining = await db
    .select({ count: sql<number>`count(*)` })
    .from(customers)
    .where(isNull(customers.customerEmbedding));
    
  console.log("\n✨ ULTRA EMBEDDING COMPLETE!");
  console.log(`   ✅ Successfully processed: ${totalProcessed}`);
  console.log(`   ❌ Errors: ${totalErrors}`);
  console.log(`   📊 Remaining without embeddings: ${remaining[0].count}`);
  
  process.exit(0);
}

// Run with error handling
ultraEmbedCustomers().catch(error => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});