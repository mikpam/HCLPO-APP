import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { contacts } from '../shared/schema.ts';
import { isNull, eq, sql } from 'drizzle-orm';

const neonSql = neon(process.env.DATABASE_URL);
const db = drizzle(neonSql);

async function parseAllRemaining() {
  console.log('🚀 COMPLETE PARSER: Starting full parsing of all remaining contacts...');
  
  let totalProcessed = 0;
  let batchNumber = 1;
  const batchSize = 2000;
  
  while (true) {
    console.log(`⚡ Processing batch ${batchNumber}...`);
    
    // Get unparsed contacts
    const unparsedContacts = await db
      .select()
      .from(contacts)
      .where(isNull(contacts.customerNumber))
      .limit(batchSize);
    
    if (unparsedContacts.length === 0) {
      console.log('✅ PARSING COMPLETE: All contacts have been processed!');
      break;
    }
    
    console.log(`   📊 Found ${unparsedContacts.length} unparsed contacts in batch ${batchNumber}`);
    
    // Process each contact
    for (let i = 0; i < unparsedContacts.length; i++) {
      const contact = unparsedContacts[i];
      
      if (contact.company) {
        // Parse customer number and company name from the combined company field
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
          .set({
            customerNumber,
            companyName
          })
          .where(eq(contacts.id, contact.id));
      }
      
      totalProcessed++;
      
      // Progress reporting
      if (totalProcessed % 500 === 0) {
        console.log(`   ⚡ PROGRESS: ${totalProcessed} contacts processed`);
      }
    }
    
    console.log(`✅ Batch ${batchNumber} complete: ${unparsedContacts.length} contacts processed`);
    batchNumber++;
  }
  
  // Final report
  const finalStats = await db
    .select({
      total: sql`count(*)`,
      parsed: sql`count(customer_number)`,
      percentage: sql`round((count(customer_number)::numeric / count(*)) * 100, 1)`
    })
    .from(contacts)
    .where(sql`company IS NOT NULL`);
  
  console.log(`🎉 FINAL RESULTS:`);
  console.log(`   📊 Total contacts: ${finalStats[0].total}`);
  console.log(`   ✅ Parsed contacts: ${finalStats[0].parsed}`);
  console.log(`   📈 Completion: ${finalStats[0].percentage}%`);
  console.log(`   🔥 Total processed in this run: ${totalProcessed}`);
}

parseAllRemaining().catch(console.error);