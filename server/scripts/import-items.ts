import { db } from '../db';
import { items } from '@shared/schema';
import * as fs from 'fs';
import * as path from 'path';

async function importItems() {
  console.log('🚀 Starting HCL Items import process...\n');
  
  // Read the CSV file
  const csvPath = path.join(process.cwd(), 'attached_assets', 'HCLitemlist_1755404528160.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV file not found:', csvPath);
    return;
  }
  
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  
  console.log(`📁 Found ${lines.length} lines in CSV file`);
  
  // Skip header line and parse data
  const header = lines[0];
  console.log('📋 Header:', header);
  
  const dataLines = lines.slice(1);
  console.log(`📊 Processing ${dataLines.length} item records...\n`);
  
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  
  // Clear existing items
  console.log('🗑️  Clearing existing items...');
  await db.delete(items);
  console.log('✅ Existing items cleared\n');
  
  // Process in batches for better performance
  const batchSize = 100;
  const batches = [];
  
  for (let i = 0; i < dataLines.length; i += batchSize) {
    batches.push(dataLines.slice(i, i + batchSize));
  }
  
  console.log(`⚡ Processing ${batches.length} batches of ${batchSize} items each...\n`);
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const itemsToInsert = [];
    
    for (const line of batch) {
      if (!line.trim()) continue;
      
      try {
        // Parse CSV line (handle commas in quoted values)
        const columns = parseCSVLine(line);
        
        if (columns.length < 9) {
          console.log(`⚠️  Skipping malformed line: ${line.substring(0, 50)}...`);
          skipped++;
          continue;
        }
        
        const [inactive, internalId, finalSku, displayName, subType, description, basePrice, taxSchedule, planner] = columns;
        
        // Skip if no internal ID or SKU
        if (!internalId || !finalSku) {
          skipped++;
          continue;
        }
        
        // Create search vector for full-text search
        const searchTerms = [
          finalSku,
          displayName,
          description || '',
          subType || ''
        ].filter(term => term).join(' ').toLowerCase();
        
        const itemData = {
          netsuiteId: internalId.trim(),
          sku: finalSku.trim(),
          finalSku: finalSku.trim(),
          displayName: displayName.trim() || finalSku.trim(),
          subType: subType?.trim() || null,
          description: description?.trim() || null,
          basePrice: basePrice?.trim() || null,
          taxSchedule: taxSchedule?.trim() || null,
          planner: planner?.trim() || null,
          isActive: inactive.toLowerCase() !== 'yes', // "Yes" means inactive
          searchVector: searchTerms,
        };
        
        itemsToInsert.push(itemData);
        
      } catch (error) {
        console.error(`❌ Error parsing line: ${line.substring(0, 50)}...`);
        console.error('   Error:', error.message);
        errors++;
      }
    }
    
    // Insert batch
    if (itemsToInsert.length > 0) {
      try {
        await db.insert(items).values(itemsToInsert);
        imported += itemsToInsert.length;
        console.log(`✅ Batch ${batchIndex + 1}/${batches.length}: Inserted ${itemsToInsert.length} items`);
      } catch (error) {
        console.error(`❌ Error inserting batch ${batchIndex + 1}:`, error.message);
        errors += itemsToInsert.length;
      }
    }
  }
  
  console.log('\n📊 Import Summary:');
  console.log(`   ✅ Successfully imported: ${imported} items`);
  console.log(`   ⚠️  Skipped (malformed/missing data): ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`   📈 Total processed: ${imported + skipped + errors}`);
  
  // Display sample items
  console.log('\n🎯 Sample imported items:');
  const sampleItems = await db.select().from(items).limit(5);
  sampleItems.forEach((item, index) => {
    console.log(`   ${index + 1}. ${item.finalSku}: ${item.displayName}`);
    console.log(`      NetSuite ID: ${item.netsuiteId} | Active: ${item.isActive}`);
  });
  
  console.log(`\n🎉 HCL Items import completed! Total items in database: ${imported}`);
}

// Helper function to parse CSV line with proper comma handling
function parseCSVLine(line: string): string[] {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current); // Add the last field
  return result.map(field => field.replace(/^"|"$/g, '')); // Remove surrounding quotes
}

// Run the import
importItems().catch(console.error);