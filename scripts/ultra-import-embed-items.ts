#!/usr/bin/env tsx
import { db } from "../server/db";
import { items } from "../shared/schema";
import { sql } from "drizzle-orm";
import fs from "fs";
import { parse } from "csv-parse/sync";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface ItemRow {
  'Inactive': string;
  'Internal ID': string;
  'FinalSku': string;
  'Display Name': string;
  'SubType': string;
  'Description': string;
  'Base Price': string;
  'Tax Schedule': string;
  'Planner': string;
}

async function importAndEmbedItems() {
  console.log("🚀 ULTRA ITEM IMPORT & EMBEDDING: Starting...");
  
  // Find all item CSV files
  const itemFiles = [
    'attached_assets/HCLitemlist_1755404528160.csv',
    'attached_assets/HCLitemlist_1755672614431.csv',
    'attached_assets/HCLitemlist_1755693975548.csv',
    'attached_assets/ItemSearchResults187.xls_1755673762891.csv'
  ];
  
  const allItems = new Map<string, any>();
  
  // Read and parse all CSV files
  for (const file of itemFiles) {
    if (!fs.existsSync(file)) {
      console.log(`   ⚠️ File not found: ${file}`);
      continue;
    }
    
    console.log(`📂 Reading ${file}...`);
    const content = fs.readFileSync(file, 'utf-8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true
    }) as ItemRow[];
    
    console.log(`   📋 Found ${records.length} records`);
    
    // Process each item
    for (const record of records) {
      const sku = record['FinalSku']?.trim();
      const internalId = record['Internal ID']?.trim();
      
      // Skip if no SKU or internal ID
      if (!sku || !internalId) continue;
      
      // Use internal ID as unique key
      const key = internalId;
      
      // Parse price
      let basePrice = null;
      if (record['Base Price']) {
        const priceStr = record['Base Price'].replace(/[$,]/g, '').trim();
        const price = parseFloat(priceStr);
        if (!isNaN(price)) {
          basePrice = price;
        }
      }
      
      // Store item (overwrites duplicates)
      allItems.set(key, {
        netsuiteId: internalId,
        sku: sku,
        finalSku: sku,
        displayName: record['Display Name']?.trim() || null,
        subType: record['SubType']?.trim() || null,
        description: record['Description']?.trim() || null,
        basePrice: basePrice,
        inactive: record['Inactive']?.toLowerCase() === 'yes',
        itemType: record['Tax Schedule']?.trim() || null
      });
    }
  }
  
  console.log(`\n📊 Total unique items to import: ${allItems.size}`);
  
  if (allItems.size === 0) {
    console.log("❌ No items to import!");
    process.exit(1);
  }
  
  // Clear existing items
  console.log("\n🗑️ Clearing existing items...");
  await db.delete(items);
  
  // Convert to array for batch processing
  const itemArray = Array.from(allItems.values());
  
  // Insert items in batches
  const INSERT_BATCH_SIZE = 500;
  let insertedCount = 0;
  
  console.log("\n💾 Inserting items into database...");
  for (let i = 0; i < itemArray.length; i += INSERT_BATCH_SIZE) {
    const batch = itemArray.slice(i, i + INSERT_BATCH_SIZE);
    
    await db.insert(items).values(
      batch.map(item => ({
        netsuiteId: item.netsuiteId,
        sku: item.sku,
        finalSku: item.finalSku,
        displayName: item.displayName,
        subType: item.subType,
        description: item.description,
        basePrice: item.basePrice ? item.basePrice.toString() : null,
        inactive: item.inactive,
        itemType: item.itemType,
        createdAt: new Date(),
        updatedAt: new Date()
      }))
    );
    
    insertedCount += batch.length;
    console.log(`   ✅ Inserted ${insertedCount}/${itemArray.length} items`);
  }
  
  // Now generate embeddings using ultra method
  console.log("\n⚡ ULTRA EMBEDDING: Generating embeddings for all items...");
  
  const itemsNeedingEmbeddings = await db
    .select({
      id: items.id,
      netsuiteId: items.netsuiteId,
      sku: items.sku,
      displayName: items.displayName,
      description: items.description,
      subType: items.subType
    })
    .from(items);
    
  console.log(`📊 Processing ${itemsNeedingEmbeddings.length} items for embeddings`);
  
  const EMBED_BATCH_SIZE = 500;
  const CONCURRENT_BATCHES = 5;
  let totalProcessed = 0;
  
  // Process in mega-batches
  for (let i = 0; i < itemsNeedingEmbeddings.length; i += EMBED_BATCH_SIZE * CONCURRENT_BATCHES) {
    const megaBatch = itemsNeedingEmbeddings.slice(i, i + EMBED_BATCH_SIZE * CONCURRENT_BATCHES);
    
    // Split into concurrent batches
    const batches = [];
    for (let j = 0; j < megaBatch.length; j += EMBED_BATCH_SIZE) {
      batches.push(megaBatch.slice(j, j + EMBED_BATCH_SIZE));
    }
    
    console.log(`\n⚡ Processing mega-batch: ${i} to ${Math.min(i + EMBED_BATCH_SIZE * CONCURRENT_BATCHES, itemsNeedingEmbeddings.length)}`);
    
    // Process all batches in parallel
    const batchPromises = batches.map(async (batch, batchIndex) => {
      try {
        // Create text for all items in this batch
        const texts = batch.map(item => {
          const parts = [
            item.sku,
            item.displayName || '',
            item.description || '',
            item.subType || ''
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
        const updatePromises = batch.map(async (item, idx) => {
          const embedding = response.data[idx].embedding;
          const embeddingString = `[${embedding.join(',')}]`;
          
          await db
            .update(items)
            .set({ 
              itemEmbedding: sql`${embeddingString}::vector`,
              updatedAt: new Date()
            })
            .where(sql`id = ${item.id}`);
            
          return item.sku;
        });
        
        const processed = await Promise.all(updatePromises);
        console.log(`   ✅ Batch ${batchIndex + 1}: ${processed.length} items embedded`);
        return processed.length;
        
      } catch (error) {
        console.error(`   ❌ Batch ${batchIndex + 1} error:`, error.message);
        return 0;
      }
    });
    
    const results = await Promise.all(batchPromises);
    const batchProcessed = results.reduce((sum, count) => sum + count, 0);
    totalProcessed += batchProcessed;
    
    console.log(`   ⚡ Mega-batch complete: ${batchProcessed} items processed`);
    console.log(`   📈 Total progress: ${totalProcessed}/${itemsNeedingEmbeddings.length} (${Math.round(totalProcessed/itemsNeedingEmbeddings.length*100)}%)`);
    
    // Small delay between mega-batches
    if (i + EMBED_BATCH_SIZE * CONCURRENT_BATCHES < itemsNeedingEmbeddings.length) {
      console.log(`   ⏳ Cooling down for 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Final verification
  const finalStats = await db
    .select({
      totalItems: sql<number>`count(*)`,
      withEmbeddings: sql<number>`count(item_embedding)`,
      withoutEmbeddings: sql<number>`count(*) filter (where item_embedding is null)`
    })
    .from(items);
    
  console.log("\n✨ ULTRA IMPORT & EMBEDDING COMPLETE!");
  console.log(`   📊 Total items: ${finalStats[0].totalItems}`);
  console.log(`   ✅ With embeddings: ${finalStats[0].withEmbeddings}`);
  console.log(`   ❌ Without embeddings: ${finalStats[0].withoutEmbeddings}`);
  
  process.exit(0);
}

// Run with error handling
importAndEmbedItems().catch(error => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});