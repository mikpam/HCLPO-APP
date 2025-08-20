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
  name: string;
  email: string;
  phone: string;
  officePhone: string;
  fax: string;
  company: string;
  altEmail: string;
}

async function crossReferenceContacts() {
  console.log('🔄 Starting contact cross-reference process...');
  
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
          csvContacts.push({
            internalId: r['Internal ID']?.trim() || '',
            name: r['Name']?.trim() || '',
            email: r['Email']?.trim() || '',
            phone: r['Phone']?.trim() || '',
            officePhone: r['Office Phone']?.trim() || '',
            fax: r['Fax']?.trim() || '',
            company: r['Company']?.trim() || '',
            altEmail: r['Alt. Email']?.trim() || '',
          });
        }
        resolve(undefined);
      });
    });

    console.log(`📊 Parsed ${csvContacts.length} contacts from CSV`);

    // Get all existing contacts from database
    const existingContacts = await db.select({
      id: contacts.id,
      netsuiteInternalId: contacts.netsuiteInternalId,
      name: contacts.name,
      company: contacts.company,
    }).from(contacts);

    console.log(`📊 Found ${existingContacts.length} existing contacts in database`);

    // Cross-reference and update
    let matchedCount = 0;
    let updatedCount = 0;
    const batchSize = 100;
    
    for (let i = 0; i < csvContacts.length; i += batchSize) {
      const batch = csvContacts.slice(i, i + batchSize);
      
      for (const csvContact of batch) {
        if (!csvContact.internalId) continue;
        
        const existingContact = existingContacts.find(
          c => c.netsuiteInternalId === csvContact.internalId
        );
        
        if (existingContact) {
          matchedCount++;
          
          // Update contact with company information if it's missing
          if (!existingContact.company && csvContact.company) {
            try {
              await db.update(contacts)
                .set({
                  company: csvContact.company,
                  officePhone: csvContact.officePhone || undefined,
                  fax: csvContact.fax || undefined,
                  altEmail: csvContact.altEmail || undefined,
                  updatedAt: new Date(),
                })
                .where(eq(contacts.netsuiteInternalId, csvContact.internalId));
              
              updatedCount++;
            } catch (error) {
              console.error(`❌ Error updating contact ${csvContact.internalId}:`, error);
            }
          }
        }
      }
      
      // Progress indicator
      if (i % 1000 === 0) {
        console.log(`📈 Processed ${i}/${csvContacts.length} CSV records...`);
      }
    }

    console.log(`✅ Cross-reference complete:`);
    console.log(`   📊 Total CSV contacts: ${csvContacts.length}`);
    console.log(`   📊 Existing DB contacts: ${existingContacts.length}`);
    console.log(`   🎯 Matched contacts: ${matchedCount}`);
    console.log(`   ✏️ Updated contacts: ${updatedCount}`);
    
    // Show some statistics
    const contactsWithCompany = await db.select().from(contacts).where(eq(contacts.company, contacts.company));
    console.log(`📊 Contacts now with company info: ${contactsWithCompany.filter(c => c.company).length}`);
    
  } catch (error) {
    console.error('❌ Error during cross-reference:', error);
  }
}

// Run the cross-reference if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  crossReferenceContacts().then(() => {
    console.log('🎉 Cross-reference process completed');
    process.exit(0);
  }).catch((error) => {
    console.error('💥 Cross-reference process failed:', error);
    process.exit(1);
  });
}

export { crossReferenceContacts };