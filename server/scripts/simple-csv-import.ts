#!/usr/bin/env tsx

import { db } from '../db.js';
import { items } from '../../shared/schema.js';
import { readFileSync } from 'fs';
import { like } from 'drizzle-orm';

async function simpleCSVImport() {
  console.log('🔄 Starting simple CSV items import...');
  
  try {
    // Read the entire file as text
    console.log('📖 Reading CSV file...');
    const csvContent = readFileSync('../attached_assets/ItemSearchResults187.xls_1755673762891.csv', 'utf8');
    
    // Split into lines and remove BOM if present
    const lines = csvContent.replace(/^\uFEFF/, '').split('\n').filter(line => line.trim());
    console.log(`📊 Found ${lines.length} lines in CSV`);
    
    // Parse header row (first line)
    const headerLine = lines[0];
    const headers = headerLine.split(',').map(h => h.trim().replace(/['"]/g, ''));
    console.log('📋 Headers:', headers);
    
    // Clear existing items
    console.log('\n🗑️  Clearing existing items table...');
    await db.delete(items);
    console.log(`✅ Cleared existing items table`);
    
    // Process data lines
    const itemsToImport = [];
    const uniqueSKUs = new Set();
    
    console.log('\n🔄 Processing CSV data...');
    for (let i = 1; i < lines.length; i++) { // Process all items
      const line = lines[i];
      if (!line.trim()) continue;
      
      // Simple CSV parsing - split by comma and clean quotes
      const values = line.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      
      if (values.length >= 5) {
        const internalId = values[0];
        const sku = values[1];
        const displayName = values[2];
        const description = values[3];
        const type = values[4];
        
        if (sku && !uniqueSKUs.has(sku)) {
          uniqueSKUs.add(sku);
          itemsToImport.push({
            netsuiteId: internalId || '',
            sku: sku,
            finalSku: sku,
            displayName: displayName || '',
            subType: type || null,
            description: description || null,
            isActive: true
          });
        }
      }
    }
    
    console.log(`📦 Prepared ${itemsToImport.length} items for import`);
    
    // Show sample
    console.log('\n📋 Sample items to import:');
    itemsToImport.slice(0, 5).forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.sku}: ${item.displayName}`);
    });
    
    // Import to database
    if (itemsToImport.length > 0) {
      console.log('\n📥 Importing items to database...');
      await db.insert(items).values(itemsToImport);
      console.log(`✅ Successfully imported ${itemsToImport.length} items`);
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
        console.log(`  - ${item.sku}: ${item.displayName}`);
      });
    }
    
    console.log('\n✅ Simple CSV import completed!');
    
  } catch (error) {
    console.error('❌ Import failed:', error);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  simpleCSVImport().catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

export { simpleCSVImport };