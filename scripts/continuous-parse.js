import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { contacts } from '../shared/schema.ts';
import { isNull, eq, sql } from 'drizzle-orm';

const neonSql = neon(process.env.DATABASE_URL);
const db = drizzle(neonSql);

async function continuousParse() {
  console.log('🔄 CONTINUOUS PARSER: Processing contacts in continuous batches...');
  
  let totalProcessed = 0;
  const batchSize = 1000; // Smaller batches for speed
  const maxBatches = 10; // Process 10 batches per run
  
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
    
    // Process contacts in this batch
    for (const contact of unparsedContacts) {
      if (contact.company) {
        const parts = contact.company.split(' - ');
        let customerNumber = null;
        let companyName = null;
        
        if (parts.length >= 2) {
          const firstPart = parts[0].trim();
          if (firstPart.match(/^C\d+$/)) {
            customerNumber = firstPart;
            companyName = parts.slice(1).join(' - ').trim();
          } else {
            companyName = contact.company.trim();
          }
        } else {
          const trimmed = contact.company.trim();
          if (trimmed.match(/^C\d+$/)) {
            customerNumber = trimmed;
          } else {
            companyName = trimmed;
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
  
  // Quick status check
  const stats = await db
    .select({
      total: sql`count(*)`,
      parsed: sql`count(customer_number)`,
      percentage: sql`round((count(customer_number)::numeric / count(*)) * 100, 1)`
    })
    .from(contacts)
    .where(sql`company IS NOT NULL`);
  
  console.log(`📊 CURRENT STATUS: ${stats[0].parsed}/${stats[0].total} contacts (${stats[0].percentage}%)`);
  console.log(`🔥 Processed in this run: ${totalProcessed} contacts`);
}

continuousParse().catch(console.error);