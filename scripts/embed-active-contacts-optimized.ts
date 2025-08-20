#!/usr/bin/env tsx

/**
 * ULTRA-OPTIMIZED Active Contact Embeddings Script
 * 
 * Generates embeddings for ACTIVE CONTACTS ONLY using mega-batch processing
 * - Only processes contacts where inactive = false
 * - Processes up to 2000 contacts per batch (OpenAI limit)
 * - Single API call per batch for maximum efficiency
 * - Parallel database updates
 * - Memory-efficient processing
 */

import { ContactEmbeddingService } from "../server/services/contact-embedding";
import { db } from "../server/db";
import { contacts } from "../shared/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

async function runActiveContactEmbeddings() {
  console.log("🚀 ACTIVE CONTACT EMBEDDINGS: Starting ultra-optimized embedding generation");
  console.log("📊 Target: ONLY ACTIVE CONTACTS (inactive = false)");
  
  const embeddingService = new ContactEmbeddingService();
  
  try {
    // Check current status of active contacts
    const activeContactStats = await db
      .select({
        total: sql<number>`count(*)`,
        embedded: sql<number>`count(*) filter (where contact_embedding is not null)`,
        unembedded: sql<number>`count(*) filter (where contact_embedding is null)`
      })
      .from(contacts)
      .where(eq(contacts.inactive, false));

    const stats = activeContactStats[0];
    console.log(`📈 ACTIVE CONTACT STATUS:`);
    console.log(`   Total Active Contacts: ${stats.total.toLocaleString()}`);
    console.log(`   Already Embedded: ${stats.embedded.toLocaleString()}`);
    console.log(`   Need Embedding: ${stats.unembedded.toLocaleString()}`);

    if (stats.unembedded === 0) {
      console.log("✅ All active contacts already have embeddings!");
      return;
    }

    console.log(`\n🔥 STARTING ULTRA-OPTIMIZED BATCH PROCESSING...`);
    console.log(`🎯 Target: ${stats.unembedded.toLocaleString()} active contacts`);

    let totalProcessed = 0;
    let batchCount = 0;
    const batchSize = 2000; // Maximum OpenAI batch size for embeddings
    
    const startTime = Date.now();

    // Process in mega-batches until all active contacts are embedded
    while (true) {
      batchCount++;
      console.log(`\n📦 MEGA-BATCH ${batchCount}: Processing up to ${batchSize} active contacts`);
      
      const processed = await embeddingService.generateActiveContactEmbeddingsOptimized(batchSize);
      
      if (processed === 0) {
        console.log("✅ All active contacts have been embedded!");
        break;
      }
      
      totalProcessed += processed;
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (totalProcessed / (Date.now() - startTime) * 1000).toFixed(1);
      
      console.log(`🎯 BATCH ${batchCount} COMPLETE: Processed ${processed} contacts`);
      console.log(`📊 TOTAL PROGRESS: ${totalProcessed.toLocaleString()} contacts in ${elapsed}s (${rate} contacts/sec)`);
      
      // Brief pause between mega-batches to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const finalRate = (totalProcessed / (Date.now() - startTime) * 1000).toFixed(1);

    console.log(`\n🎉 ACTIVE CONTACT EMBEDDINGS COMPLETE!`);
    console.log(`📊 FINAL STATS:`);
    console.log(`   Active Contacts Processed: ${totalProcessed.toLocaleString()}`);
    console.log(`   Total Time: ${totalTime} seconds`);
    console.log(`   Average Rate: ${finalRate} contacts per second`);
    console.log(`   Batches Used: ${batchCount}`);

    // Final verification
    const finalStats = await db
      .select({
        total: sql<number>`count(*)`,
        embedded: sql<number>`count(*) filter (where contact_embedding is not null)`,
        unembedded: sql<number>`count(*) filter (where contact_embedding is null)`
      })
      .from(contacts)
      .where(eq(contacts.inactive, false));

    const final = finalStats[0];
    const completionRate = ((final.embedded / final.total) * 100).toFixed(1);

    console.log(`\n✅ VERIFICATION COMPLETE:`);
    console.log(`   Active Contacts with Embeddings: ${final.embedded.toLocaleString()}/${final.total.toLocaleString()} (${completionRate}%)`);
    
    if (final.unembedded === 0) {
      console.log(`🎉 SUCCESS: 100% of active contacts now have embeddings!`);
    } else {
      console.log(`⚠️  WARNING: ${final.unembedded} active contacts still need embeddings`);
    }

  } catch (error) {
    console.error("❌ ACTIVE CONTACT EMBEDDING ERROR:", error);
    throw error;
  }
}

// Run the script
runActiveContactEmbeddings()
  .then(() => {
    console.log("🏁 Active contact embedding script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Active contact embedding script failed:", error);
    process.exit(1);
  });