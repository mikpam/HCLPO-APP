import { parse } from 'csv-parse';
import fs from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { contacts } from '../shared/schema.js';
import { eq } from 'drizzle-orm';

// Initialize database connection
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

interface CSVContact {
  internalId: string;
  company: string;
}

async function updateCompanyInfo() {
  console.log('🔄 Starting company info update...');
  
  try {
    // Read and parse the CSV file
    const csvPath = path.join(process.cwd(), 'attached_assets', 'ContactSearchResults926_1755654273634.csv');
    const csvData = fs.readFileSync(csvPath, 'utf-8');
    
    const csvContacts: CSVContact[] = [];
    
    // Parse CSV data
    await new Promise((resolve, reject) => {
      parse(csvData, {
        columns: true,
        skip_empty_lines: true,
      }, (err, records) => {
        if (err) {
          reject(err);
          return;
        }
        
        for (const record of records) {
          const r = record as Record<string, string>;
          const internalId = r['Internal ID']?.trim();
          const company = r['Company']?.trim();
          
          if (internalId && company) {
            csvContacts.push({ internalId, company });
          }
        }
        resolve(undefined);
      });
    });

    console.log(`📊 Parsed ${csvContacts.length} contacts with company info from CSV`);

    // Update contacts with company information in batches
    let updatedCount = 0;
    const batchSize = 50;
    
    for (let i = 0; i < csvContacts.length; i += batchSize) {
      const batch = csvContacts.slice(i, i + batchSize);
      
      for (const csvContact of batch) {
        try {
          const result = await db.update(contacts)
            .set({
              company: csvContact.company,
              updatedAt: new Date(),
            })
            .where(eq(contacts.netsuiteInternalId, csvContact.internalId));
          
          updatedCount++;
        } catch (error) {
          console.error(`❌ Error updating contact ${csvContact.internalId}:`, error);
        }
      }
      
      // Progress indicator
      if (i % 1000 === 0) {
        console.log(`📈 Processed ${i}/${csvContacts.length} CSV records...`);
      }
    }

    console.log(`✅ Company info update complete:`);
    console.log(`   📊 Total CSV contacts with company: ${csvContacts.length}`);
    console.log(`   ✏️ Updated contacts: ${updatedCount}`);
    
    // Show some statistics
    const contactsWithCompany = await db.select().from(contacts).where(eq(contacts.company, contacts.company));
    const withCompanyCount = contactsWithCompany.filter(c => c.company && c.company.trim() !== '').length;
    console.log(`📊 Contacts now with company info: ${withCompanyCount}`);
    
  } catch (error) {
    console.error('❌ Error during company info update:', error);
  }
}

// Run the update if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateCompanyInfo().then(() => {
    console.log('🎉 Company info update completed');
    process.exit(0);
  }).catch((error) => {
    console.error('💥 Company info update failed:', error);
    process.exit(1);
  });
}

export { updateCompanyInfo };