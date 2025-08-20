#!/usr/bin/env tsx

import { db } from '../db.js';
import { sql } from 'drizzle-orm';

async function checkItemCount() {
  try {
    console.log('📊 Checking current item database status...\n');
    
    // Get total count
    const result = await db.execute(sql`SELECT count(*) as count FROM items`);
    const totalItems = result.rows[0].count;
    
    // Get embedded count
    const embeddedResult = await db.execute(sql`SELECT count(*) as count FROM items WHERE item_embedding IS NOT NULL`);
    const embeddedItems = embeddedResult.rows[0].count;
    
    console.log(`📈 DATABASE SUMMARY:`);
    console.log(`   Total items: ${totalItems}`);
    console.log(`   Items with embeddings: ${embeddedItems}`);
    console.log(`   Embedding completion: ${totalItems > 0 ? Math.round((embeddedItems / totalItems) * 100) : 0}%`);
    
    // Sample recent items
    console.log(`\n📋 Sample recent items:`);
    const sampleResult = await db.execute(sql`SELECT sku, display_name FROM items ORDER BY created_at DESC LIMIT 10`);
    sampleResult.rows.forEach((item, i) => {
      console.log(`   ${i+1}. ${item.sku}: ${item.display_name}`);
    });
    
    // Check for specific missing items that were mentioned
    console.log(`\n🔍 Checking for core products:`);
    const jagBagResult = await db.execute(sql`SELECT sku, display_name FROM items WHERE sku LIKE '1001-%' OR sku LIKE '1002-%' LIMIT 5`);
    if (jagBagResult.rows.length > 0) {
      console.log(`   ✅ Jag Bags found: ${jagBagResult.rows.length}`);
      jagBagResult.rows.forEach((item) => {
        console.log(`      - ${item.sku}: ${item.display_name}`);
      });
    } else {
      console.log(`   ❌ No Jag Bags found`);
    }
    
  } catch (error) {
    console.error('❌ Error checking database:', error);
  }
}

checkItemCount();