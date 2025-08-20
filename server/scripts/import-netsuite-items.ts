#!/usr/bin/env tsx

import { db } from '../db.js';
import { items } from '../../shared/schema.js';

interface NetSuiteItem {
  'Internal ID': string;
  'Name': string;
  'Display Name': string;
  'Description': string;
  'Type': string;
}

async function importNetSuiteItems() {
  console.log('🔄 Starting NetSuite items import...');

  try {
    // Dynamically import XLSX to work with ES modules
    const xlsxModule = await import('xlsx');
    const XLSX = xlsxModule.default || xlsxModule;
    
    // Read the Excel file
    console.log('📖 Reading Excel file...');
    const workbook = XLSX.readFile('../attached_assets/ItemSearchResults187.xls_1755673104410.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data: NetSuiteItem[] = XLSX.utils.sheet_to_json(worksheet);
    console.log(`📊 Found ${data.length} items in NetSuite export`);

    // Display sample of data
    console.log('\n📋 Sample data:');
    data.slice(0, 3).forEach((item, index) => {
      console.log(`  ${index + 1}. SKU: ${item.Name} | Name: ${item['Display Name']}`);
    });

    // Clear existing items
    console.log('\n🗑️  Clearing existing items table...');
    await db.delete(items);
    console.log(`✅ Cleared existing items table`);

    // Prepare items for import
    console.log('\n🔄 Preparing items for import...');
    const itemsToImport = data
      .filter(item => item.Name && item.Name.trim()) // Only items with valid SKUs
      .map(item => ({
        netsuiteId: item['Internal ID']?.toString() || '',
        sku: item.Name?.trim() || '',
        finalSku: item.Name?.trim() || '',
        displayName: item['Display Name']?.trim() || '',
        subType: item.Type?.trim() || null,
        description: item.Description?.trim() || null,
        isActive: true // Default to active since no inactive flag in this export
      }));

    console.log(`📦 Prepared ${itemsToImport.length} valid items for import`);

    // Import in batches
    const BATCH_SIZE = 1000;
    let totalImported = 0;

    for (let i = 0; i < itemsToImport.length; i += BATCH_SIZE) {
      const batch = itemsToImport.slice(i, i + BATCH_SIZE);
      console.log(`📥 Importing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(itemsToImport.length / BATCH_SIZE)} (${batch.length} items)...`);
      
      try {
        await db.insert(items).values(batch);
        totalImported += batch.length;
        console.log(`✅ Successfully imported ${totalImported}/${itemsToImport.length} items`);
      } catch (error) {
        console.error(`❌ Error importing batch starting at item ${i + 1}:`, error);
        // Log the problematic batch
        console.log('Problematic items:', batch.slice(0, 3).map(item => ({
          sku: item.sku,
          finalSku: item.finalSku,
          displayName: item.displayName
        })));
      }
    }

    // Verify import
    console.log('\n🔍 Verifying import...');
    const itemCount = await db.$count(items);
    console.log(`✅ Import completed! Total items in database: ${itemCount}`);

    // Show sample of imported items
    const sampleItems = await db.select({
      finalSku: items.finalSku,
      displayName: items.displayName,
      netsuiteId: items.netsuiteId
    })
    .from(items)
    .limit(5);

    console.log('\n📋 Sample imported items:');
    sampleItems.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.finalSku}: ${item.displayName} (ID: ${item.netsuiteId})`);
    });

    console.log('\n✅ NetSuite items import completed successfully!');
    console.log('🚀 Ready to run ultra-optimized embeddings on complete dataset');
    
  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  }
}

// Run the import
importNetSuiteItems();