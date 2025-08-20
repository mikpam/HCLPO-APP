#!/usr/bin/env tsx

import { db } from '../db.js';
import { items } from '../../shared/schema.js';
import { like } from 'drizzle-orm';

async function checkLCPolos() {
  console.log('🔍 Checking for LC Performance Polos...');
  
  // Check for items with 334 prefix (LC Performance Polos)
  const lcPolos = await db.select()
    .from(items)
    .where(like(items.sku, '334%'))
    .limit(10);

  if (lcPolos.length > 0) {
    console.log(`🥽 Found ${lcPolos.length} LC Performance Polos:`);
    lcPolos.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.sku}: ${item.displayName}`);
    });
  } else {
    console.log('❌ No LC Performance Polos found');
  }

  // Check total item count
  const totalCount = await db.$count(items);
  console.log(`\n📊 Total items in database: ${totalCount}`);

  // Check for some other common patterns
  const otherSamples = await db.select()
    .from(items)
    .limit(5);
  
  console.log('\n📋 Sample items in database:');
  otherSamples.forEach((item, index) => {
    console.log(`  ${index + 1}. ${item.sku}: ${item.displayName}`);
  });
}

checkLCPolos().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});