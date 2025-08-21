#!/usr/bin/env node

/**
 * Parse Company Fields Script
 * 
 * This script parses the existing 'company' field in the contacts table
 * and populates the new 'customerNumber' and 'companyName' fields.
 * 
 * Example: "C14303 NPN360 Inc." becomes:
 * - customerNumber: "C14303"
 * - companyName: "NPN360 Inc."
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { contacts } from '../shared/schema.ts';
import { eq, isNotNull, and, sql } from 'drizzle-orm';

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

async function parseCompanyFields() {
  console.log('🔍 COMPANY FIELD PARSER: Starting to parse contact company fields...');
  
  try {
    // Count total contacts first
    console.log('📊 Counting total contacts with company data...');
    const totalCount = await db
      .select({ count: sql`count(*)::int` })
      .from(contacts)
      .where(isNotNull(contacts.company));
    
    const total = totalCount[0]?.count || 0;
    console.log(`📊 Found ${total} contacts with company data to process`);

    if (total === 0) {
      console.log('✅ No contacts need parsing. All done!');
      return;
    }

    let updatedCount = 0;
    let queryBatchSize = 500; // Smaller query batches to avoid memory issues
    let updateBatchSize = 50; // Even smaller update batches

    // Process in smaller query batches to avoid memory issues
    for (let offset = 0; offset < total; offset += queryBatchSize) {
      console.log(`🔍 Fetching batch ${Math.floor(offset/queryBatchSize) + 1}/${Math.ceil(total/queryBatchSize)} (offset: ${offset})...`);
      
      const batch = await db
        .select({
          id: contacts.id,
          company: contacts.company,
          customerNumber: contacts.customerNumber,
          companyName: contacts.companyName
        })
        .from(contacts)
        .where(isNotNull(contacts.company))
        .limit(queryBatchSize)
        .offset(offset);

      console.log(`📝 Processing ${batch.length} contacts in this batch...`);

      // Update each contact in smaller sub-batches
      for (let i = 0; i < batch.length; i += updateBatchSize) {
        const subBatch = batch.slice(i, i + updateBatchSize);
        
        for (const contact of subBatch) {
          // Skip if already parsed (avoid overwriting manually corrected data)
          if (contact.customerNumber || contact.companyName) {
            continue;
          }
          
          const { customerNumber, companyName } = parseCompanyField(contact.company);
          
          await db
            .update(contacts)
            .set({
              customerNumber,
              companyName,
              updatedAt: new Date()
            })
            .where(eq(contacts.id, contact.id));

          updatedCount++;

          // Log sample results
          if (updatedCount <= 20 && updatedCount % 5 === 0) {
            console.log(`   📝 Example ${updatedCount}: "${contact.company}" → Customer: "${customerNumber}", Company: "${companyName}"`);
          }
        }

        // Progress indicator
        if (updatedCount % 100 === 0) {
          console.log(`   ✅ Progress: ${updatedCount}/${total} contacts processed (${Math.round((updatedCount/total)*100)}%)`);
        }

        // Small delay between sub-batches
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Delay between major batches to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`✅ PARSING COMPLETE: Updated ${updatedCount} contacts`);
    console.log('🎯 New fields populated:');
    console.log('   - customerNumber: Extracted customer numbers (e.g., "C14303")');
    console.log('   - companyName: Clean company names (e.g., "NPN360 Inc.")');

  } catch (error) {
    console.error('❌ Error parsing company fields:', error);
    throw error;
  }
}

// Run the script
parseCompanyFields()
  .then(() => {
    console.log('🏁 Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });