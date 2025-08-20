import { parse } from 'csv-parse';
import fs from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { contacts } from '../shared/schema.js';

// Initialize database connection
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

interface CSVContact {
  internalId: string;
  name: string;
  email: string;
  phone: string;
  officePhone: string;
  fax: string;
  company: string;
  altEmail: string;
}

async function importContactsFresh() {
  console.log('🔄 Starting fresh contact import...');
  
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
          const name = r['Name']?.trim();
          
          // Only include contacts with valid Internal ID and Name
          if (internalId && name) {
            csvContacts.push({
              internalId,
              name,
              email: r['Email']?.trim() || '',
              phone: r['Phone']?.trim() || '',
              officePhone: r['Office Phone']?.trim() || '',
              fax: r['Fax']?.trim() || '',
              company: r['Company']?.trim() || '',
              altEmail: r['Alt. Email']?.trim() || '',
            });
          }
        }
        resolve(undefined);
      });
    });

    console.log(`📊 Parsed ${csvContacts.length} valid contacts from CSV`);

    // Import contacts in batches to avoid memory issues
    let importedCount = 0;
    const batchSize = 100;
    const totalBatches = Math.ceil(csvContacts.length / batchSize);
    
    for (let i = 0; i < csvContacts.length; i += batchSize) {
      const batch = csvContacts.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;
      
      try {
        // Insert batch
        const insertData = batch.map(contact => ({
          netsuiteInternalId: contact.internalId,
          name: contact.name,
          email: contact.email || null,
          phone: contact.phone || null,
          officePhone: contact.officePhone || null,
          fax: contact.fax || null,
          company: contact.company || null,
          altEmail: contact.altEmail || null,
          inactive: false,
          duplicate: false,
          loginAccess: false,
          verified: false,
        }));

        await db.insert(contacts).values(insertData);
        importedCount += batch.length;
        
        // Progress indicator
        if (currentBatch % 10 === 0) {
          console.log(`📈 Processed batch ${currentBatch}/${totalBatches} (${importedCount}/${csvContacts.length} contacts)`);
        }
      } catch (error) {
        console.error(`❌ Error importing batch ${currentBatch}:`, error);
        // Continue with next batch
      }
    }

    console.log(`✅ Fresh import complete:`);
    console.log(`   📊 Total CSV contacts: ${csvContacts.length}`);
    console.log(`   ✏️ Successfully imported: ${importedCount}`);
    
    // Show final statistics
    const finalCount = await db.select().from(contacts);
    const withCompanyCount = finalCount.filter(c => c.company && c.company.trim() !== '').length;
    const withEmailCount = finalCount.filter(c => c.email && c.email.trim() !== '').length;
    
    console.log(`📊 Final statistics:`);
    console.log(`   📊 Total contacts in database: ${finalCount.length}`);
    console.log(`   📊 Contacts with company info: ${withCompanyCount}`);
    console.log(`   📊 Contacts with email: ${withEmailCount}`);
    
  } catch (error) {
    console.error('❌ Error during fresh import:', error);
  }
}

// Run the import if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  importContactsFresh().then(() => {
    console.log('🎉 Fresh contact import completed');
    process.exit(0);
  }).catch((error) => {
    console.error('💥 Fresh contact import failed:', error);
    process.exit(1);
  });
}

export { importContactsFresh };