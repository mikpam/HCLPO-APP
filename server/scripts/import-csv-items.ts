#!/usr/bin/env tsx

import { db } from '../db.js';
import { items } from '../../shared/schema.js';
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { like } from 'drizzle-orm';

interface CSVItem {
  'Internal ID': string;
  'Name': string;
  'Display Name': string;
  'Description': string;
  'Type': string;
}

async function importCSVItems() {
  console.log('🔄 Starting CSV items import...');
  console.log('📖 Reading CSV file...');
  
  const records: CSVItem[] = [];
  
  // Parse CSV file
  await new Promise<void>((resolve, reject) => {
    createReadStream('../attached_assets/ItemSearchResults187.xls_1755673762891.csv', { encoding: 'utf8' })
      .pipe(parse({ 
        headers: true,
        skipEmptyLines: true,
        delimiter: ',',
        quote: '"',
        bom: true, // Handle BOM character
        trim: true
      }))
      .on('data', (record) => {
        records.push(record);
      })
      .on('end', () => {
        resolve();
      })
      .on('error', (error) => {
        reject(error);
      });
  });

  console.log(`📊 Found ${records.length} items in CSV`);

  // Display sample of data
  console.log('\n📋 Sample data:');
  records.slice(0, 5).forEach((item, index) => {
    console.log(`  ${index + 1}. SKU: ${item.Name} | Name: ${item['Display Name']}`);
  });

  // Clear existing items
  console.log('\n🗑️  Clearing existing items table...');
  await db.delete(items);
  console.log(`✅ Cleared existing items table`);

  // Filter and prepare items for import (remove duplicates by SKU)
  console.log('\n🔄 Preparing items for import...');
  const uniqueItems = new Map();
  
  for (const item of records) {
    if (item.Name && item.Name.trim()) {
      // Use Name as the unique key, keep first occurrence
      if (!uniqueItems.has(item.Name.trim())) {
        uniqueItems.set(item.Name.trim(), {
          netsuiteId: item['Internal ID']?.toString() || '',
          sku: item.Name.trim(),
          finalSku: item.Name.trim(),
          displayName: item['Display Name']?.trim() || '',
          subType: item.Type?.trim() || null,
          description: item.Description?.trim() || null,
          isActive: true
        });
      }
    }
  }

  const itemsToImport = Array.from(uniqueItems.values());
  console.log(`📦 Prepared ${itemsToImport.length} unique items for import (removed ${records.length - itemsToImport.length} duplicates)`);

  // Import in batches
  const batchSize = 1000;
  let imported = 0;
  
  for (let i = 0; i < itemsToImport.length; i += batchSize) {
    const batch = itemsToImport.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(itemsToImport.length / batchSize);
    
    console.log(`📥 Importing batch ${batchNumber}/${totalBatches} (${batch.length} items)...`);
    
    try {
      await db.insert(items).values(batch);
      imported += batch.length;
      console.log(`✅ Successfully imported ${imported}/${itemsToImport.length} items`);
    } catch (error) {
      console.error(`❌ Error importing batch starting at item ${i + 1}:`, error);
      // Show problematic items
      console.log('Problematic items:', batch.slice(0, 3).map(item => ({
        sku: item.sku,
        finalSku: item.finalSku,
        displayName: item.displayName
      })));
    }
  }

  // Verify import
  console.log('\n🔍 Verifying import...');
  const totalCount = await db.$count(items);
  console.log(`✅ Import completed! Total items in database: ${totalCount}`);

  // Show sample of imported items
  const sampleItems = await db.select({
    sku: items.sku,
    displayName: items.displayName,
    netsuiteId: items.netsuiteId
  })
  .from(items)
  .limit(10);

  console.log('\n📋 Sample imported items:');
  sampleItems.forEach((item, index) => {
    console.log(`  ${index + 1}. ${item.sku}: ${item.displayName} (ID: ${item.netsuiteId})`);
  });

  // Check for Jag Bags specifically
  const jagBags = await db.select()
    .from(items)
    .where(like(items.sku, '100%'))
    .limit(5);
  
  if (jagBags.length > 0) {
    console.log(`\n🎒 Found ${jagBags.length} Jag Bag items:`);
    jagBags.forEach(item => {
      console.log(`  - ${item.sku}: ${item.displayName}`);
    });
  }

  console.log('\n✅ CSV items import completed successfully!');
  console.log('🚀 Ready to run ultra-optimized embeddings on complete dataset');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importCSVItems().catch(error => {
    console.error('Import failed:', error);
    process.exit(1);
  });
}

export { importCSVItems };