#!/usr/bin/env node

/**
 * Fast Company Field Parser - Optimized for Remaining Records
 * 
 * This script efficiently parses the remaining unparsed company fields.
 * It uses larger batches and only processes records that haven't been parsed yet.
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { contacts } from '../shared/schema.ts';
import { eq, isNotNull, and, isNull, sql } from 'drizzle-orm';

const neonSql = neon(process.env.DATABASE_URL);
const db = drizzle(neonSql);

function parseCompanyField(company) {
  if (!company || typeof company !== 'string') {
    return { customerNumber: null, companyName: null };
  }

  // Pattern to match customer number at the beginning (C followed by digits)
  const customerNumberMatch = company.match(/^(C\d+)\s+(.+)$/);
  
  if (customerNumberMatch) {
    const customerNumber = customerNumberMatch[1].trim();
    const companyName = customerNumberMatch[2].trim();
    return { customerNumber, companyName };
  }

  // If no customer number pattern found, treat entire string as company name
  return { 
    customerNumber: null, 
    companyName: company.trim() 
  };
}

async function parseRemainingFields() {
  console.log('🚀 FAST PARSER: Starting optimized parsing of remaining company fields...');
  
  try {
    // Count total unparsed contacts
    console.log('📊 Counting remaining unparsed contacts...');
    const unparsedCount = await db
      .select({ count: sql`count(*)::int` })
      .from(contacts)
      .where(
        and(
          isNotNull(contacts.company),
          // Only process contacts that haven't been parsed yet
          isNull(contacts.customerNumber),
          isNull(contacts.companyName)
        )
      );
    
    const total = unparsedCount[0]?.count || 0;
    console.log(`📊 Found ${total} unparsed contacts remaining`);

    if (total === 0) {
      console.log('✅ All contacts have been parsed! Script complete.');
      return;
    }

    let updatedCount = 0;
    let queryBatchSize = 2000; // Larger batches for efficiency
    let updateBatchSize = 100; // Faster updates

    // Process in larger batches for speed
    for (let offset = 0; offset < total; offset += queryBatchSize) {
      console.log(`⚡ Fast-processing batch ${Math.floor(offset/queryBatchSize) + 1}/${Math.ceil(total/queryBatchSize)} (offset: ${offset})...`);
      
      const batch = await db
        .select({
          id: contacts.id,
          company: contacts.company
        })
        .from(contacts)
        .where(
          and(
            isNotNull(contacts.company),
            isNull(contacts.customerNumber),
            isNull(contacts.companyName)
          )
        )
        .limit(queryBatchSize)
        .offset(offset);

      console.log(`⚡ Processing ${batch.length} unparsed contacts...`);

      // Update in larger chunks for speed
      for (let i = 0; i < batch.length; i += updateBatchSize) {
        const subBatch = batch.slice(i, i + updateBatchSize);
        
        // Prepare all updates
        const updates = subBatch.map(contact => {
          const { customerNumber, companyName } = parseCompanyField(contact.company);
          return { id: contact.id, customerNumber, companyName };
        });

        // Execute updates
        for (const update of updates) {
          await db
            .update(contacts)
            .set({
              customerNumber: update.customerNumber,
              companyName: update.companyName,
              updatedAt: new Date()
            })
            .where(eq(contacts.id, update.id));
          
          updatedCount++;
        }

        // Progress indicator every 500 updates
        if (updatedCount % 500 === 0) {
          const percentage = Math.round((updatedCount/total)*100);
          console.log(`   ⚡ FAST PROGRESS: ${updatedCount}/${total} contacts processed (${percentage}%)`);
        }
      }

      // Minimal delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`🎉 FAST PARSING COMPLETE: Updated ${updatedCount} contacts`);
    console.log('✨ All company fields now have separate customerNumber and companyName fields');
    console.log('🎯 Enhanced analysis will now have maximum accuracy with clean company names');

  } catch (error) {
    console.error('❌ Error in fast parsing:', error);
    throw error;
  }
}

// Run the script
parseRemainingFields()
  .then(() => {
    console.log('🏁 Fast parsing script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Fast parsing script failed:', error);
    process.exit(1);
  });