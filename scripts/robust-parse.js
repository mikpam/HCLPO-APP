import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { contacts } from '../shared/schema.ts';
import { isNull, eq, sql } from 'drizzle-orm';

const neonSql = neon(process.env.DATABASE_URL);
const db = drizzle(neonSql);

async function robustParse() {
  console.log('🔧 ROBUST PARSER: Starting enhanced parsing for all patterns...');
  
  let totalProcessed = 0;
  const batchSize = 1000;
  const maxBatches = 20;
  
  for (let batchNum = 1; batchNum <= maxBatches; batchNum++) {
    // Get unparsed contacts
    const unparsedContacts = await db
      .select()
      .from(contacts)
      .where(isNull(contacts.customerNumber))
      .limit(batchSize);
    
    if (unparsedContacts.length === 0) {
      console.log('✅ PARSING COMPLETE: All contacts processed!');
      break;
    }
    
    console.log(`⚡ Batch ${batchNum}: Processing ${unparsedContacts.length} contacts...`);
    
    // Process each contact with enhanced logic
    for (const contact of unparsedContacts) {
      if (contact.company) {
        let customerNumber = null;
        let companyName = null;
        
        const company = contact.company.trim();
        
        // Pattern 1: "c1958 American Solutions for Business" (lowercase c + number)
        const lowercasePattern = /^c(\d+)\s+(.+)$/i;
        const lowercaseMatch = company.match(lowercasePattern);
        
        if (lowercaseMatch) {
          customerNumber = `C${lowercaseMatch[1]}`;
          companyName = lowercaseMatch[2].trim();
        }
        // Pattern 2: "C1958 - American Solutions for Business" (uppercase C with dash)
        else {
          const parts = company.split(' - ');
          if (parts.length >= 2) {
            const firstPart = parts[0].trim();
            if (firstPart.match(/^C\d+$/)) {
              customerNumber = firstPart;
              companyName = parts.slice(1).join(' - ').trim();
            } else {
              companyName = company;
            }
          } else {
            // Pattern 3: Just "C1958" or just company name
            if (company.match(/^C\d+$/)) {
              customerNumber = company;
            } else {
              companyName = company;
            }
          }
        }
        
        // Update the contact
        await db
          .update(contacts)
          .set({ customerNumber, companyName })
          .where(eq(contacts.id, contact.id));
      }
      totalProcessed++;
    }
    
    console.log(`   ✅ Batch ${batchNum} complete: ${unparsedContacts.length} contacts processed`);
  }
  
  // Final status
  const stats = await db
    .select({
      total: sql`count(*)`,
      parsed: sql`count(customer_number)`,
      percentage: sql`round((count(customer_number)::numeric / count(*)) * 100, 1)`
    })
    .from(contacts)
    .where(sql`company IS NOT NULL`);
  
  console.log(`🎉 FINAL RESULTS:`);
  console.log(`   📊 Total contacts: ${stats[0].total}`);
  console.log(`   ✅ Parsed contacts: ${stats[0].parsed}`);
  console.log(`   📈 Completion: ${stats[0].percentage}%`);
  console.log(`   🔥 Processed in this run: ${totalProcessed}`);
}

robustParse().catch(console.error);