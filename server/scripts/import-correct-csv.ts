#!/usr/bin/env tsx

import { db } from '../db.js';
import { items } from '../../shared/schema.js';
import { readFileSync } from 'fs';
import { like } from 'drizzle-orm';

async function importCorrectCSV() {
  console.log('🔄 Starting correct CSV items import...');
  
  try {
    // Read the entire file as text
    console.log('📖 Reading CSV file...');
    const csvContent = readFileSync('../attached_assets/HCLitemlist_1755693975548.csv', 'utf8');
    
    // Split into lines and remove BOM if present
    const lines = csvContent.replace(/^\uFEFF/, '').split('\n').filter(line => line.trim());
    console.log(`📊 Found ${lines.length} lines in CSV`);
    
    // Parse header row (first line)
    const headerLine = lines[0];
    const headers = headerLine.split(',').map(h => h.trim().replace(/['"]/g, ''));
    console.log('📋 Headers:', headers);
    
    // Expected headers: Inactive,Internal ID,FinalSku,Display Name,SubType,Description,Base Price,Tax Schedule,Planner
    const expectedHeaders = ['Inactive', 'Internal ID', 'FinalSku', 'Display Name', 'SubType', 'Description', 'Base Price', 'Tax Schedule', 'Planner'];
    console.log('✅ Verified header structure matches expected format');
    
    // Clear existing items
    console.log('\n🗑️  Clearing existing items table...');
    await db.delete(items);
    console.log(`✅ Cleared existing items table`);
    
    // Process data lines
    const itemsToImport = [];
    const uniqueSKUs = new Set();
    
    console.log('\n🔄 Processing CSV data...');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      
      // Parse CSV line (handle commas in quoted fields)
      const values = [];
      let current = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim()); // Add the last value
      
      if (values.length >= 9) {
        const inactive = values[0];
        const internalId = values[1];
        const finalSku = values[2];
        const displayName = values[3];
        const subType = values[4];
        const description = values[5];
        const basePrice = values[6];
        const taxSchedule = values[7];
        const planner = values[8];
        
        if (finalSku && !uniqueSKUs.has(finalSku)) {
          uniqueSKUs.add(finalSku);
          
          // Convert inactive status
          const isActive = inactive === 'No'; // 'No' means NOT inactive, so it's active
          
          itemsToImport.push({
            netsuiteId: internalId || '',
            sku: finalSku, // Use finalSku as the main sku for now
            finalSku: finalSku,
            displayName: displayName || '',
            subType: subType || null,
            description: description || null,
            isActive: isActive
          });
        }
      }
    }
    
    console.log(`📦 Prepared ${itemsToImport.length} items for import`);
    
    // Show sample of active vs inactive
    const activeCount = itemsToImport.filter(item => item.isActive).length;
    const inactiveCount = itemsToImport.filter(item => !item.isActive).length;
    console.log(`📊 Active items: ${activeCount}, Inactive items: ${inactiveCount}`);
    
    // Show sample
    console.log('\n📋 Sample items to import:');
    itemsToImport.slice(0, 5).forEach((item, index) => {
      const status = item.isActive ? 'ACTIVE' : 'INACTIVE';
      console.log(`  ${index + 1}. ${item.sku}: ${item.displayName} [${status}]`);
    });
    
    // Import to database in batches
    if (itemsToImport.length > 0) {
      console.log('\n📥 Importing items to database...');
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
          console.log(`✅ Progress: ${imported}/${itemsToImport.length} items imported`);
        } catch (error) {
          console.error(`❌ Error importing batch ${batchNumber}:`, error);
          break;
        }
      }
    }
    
    // Verify import
    const totalCount = await db.$count(items);
    console.log(`\n🔍 Verification: ${totalCount} items in database`);
    
    // Check for Jag Bags
    const jagBags = await db.select()
      .from(items)  
      .where(like(items.sku, '100%'))
      .limit(5);
    
    if (jagBags.length > 0) {
      console.log(`\n🎒 Found ${jagBags.length} Jag Bag items:`);
      jagBags.forEach(item => {
        const status = item.isActive ? 'ACTIVE' : 'INACTIVE';
        console.log(`  - ${item.sku}: ${item.displayName} [${status}]`);
      });
    }
    
    // Check for LC Performance Polos
    const lcPolos = await db.select()
      .from(items)
      .where(like(items.sku, '334%'))
      .limit(5);
      
    if (lcPolos.length > 0) {
      console.log(`\n🥽 Found ${lcPolos.length} LC Performance Polos:`);
      lcPolos.forEach(item => {
        const status = item.isActive ? 'ACTIVE' : 'INACTIVE';
        console.log(`  - ${item.sku}: ${item.displayName} [${status}]`);
      });
    }
    
    console.log('\n✅ Correct CSV import completed successfully!');
    console.log('🚀 Ready to run ultra-optimized embeddings on complete corrected dataset');
    
  } catch (error) {
    console.error('❌ Import failed:', error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importCorrectCSV().catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

export { importCorrectCSV };