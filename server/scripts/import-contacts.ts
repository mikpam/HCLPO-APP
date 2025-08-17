import { readFileSync } from 'fs';
import { db } from '../db';
import { contacts } from '../../shared/schema';
import { eq } from 'drizzle-orm';

interface ContactRecord {
  inactive: string;
  internalId: string;
  name: string;
  duplicate: string;
  jobTitle: string;
  phone: string;
  email: string;
  loginAccess: string;
}

function parseCSV(csvContent: string): ContactRecord[] {
  const lines = csvContent.split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  
  return lines.slice(1)
    .filter(line => line.trim())
    .map(line => {
      const values = parseCSVLine(line);
      return {
        inactive: values[0] || '',
        internalId: values[1] || '',
        name: values[2] || '',
        duplicate: values[3] || '',
        jobTitle: values[4] || '',
        phone: values[5] || '',
        email: values[6] || '',
        loginAccess: values[7] || ''
      };
    })
    .filter(record => record.internalId && record.internalId !== 'Internal ID' && record.name);
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  values.push(current.trim());
  return values;
}

async function importContacts() {
  try {
    console.log('📄 Reading HCL contacts CSV...');
    
    const csvContent = readFileSync('./attached_assets/HCL contacts_1755401796156.csv', 'utf-8');
    const records = parseCSV(csvContent);
    
    console.log(`📊 Found ${records.length} contact records`);
    
    // Clear existing contacts
    console.log('🗑️ Clearing existing contacts...');
    await db.delete(contacts);
    
    // Insert contacts in batches
    const batchSize = 100;
    let imported = 0;
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      const contactData = batch.map(record => ({
        netsuiteInternalId: record.internalId,
        name: record.name,
        jobTitle: record.jobTitle || null,
        phone: record.phone || null,
        email: record.email || null,
        inactive: record.inactive.toLowerCase() === 'yes',
        duplicate: record.duplicate.toLowerCase() === 'yes',
        loginAccess: record.loginAccess.toLowerCase() === 'yes',
        searchVector: `${record.name} ${record.email} ${record.jobTitle}`.toLowerCase().trim()
      }));
      
      try {
        await db.insert(contacts).values(contactData);
        imported += batch.length;
        console.log(`✅ Imported batch ${Math.floor(i/batchSize) + 1}: ${imported}/${records.length} contacts`);
      } catch (error) {
        console.error(`❌ Error importing batch ${Math.floor(i/batchSize) + 1}:`, error);
        // Skip duplicates and continue
        for (const contact of contactData) {
          try {
            await db.insert(contacts).values(contact);
            imported++;
          } catch (singleError) {
            console.log(`⚠️ Skipped duplicate: ${contact.name} (ID: ${contact.netsuiteInternalId})`);
          }
        }
      }
    }
    
    console.log(`🎉 Successfully imported ${imported} HCL contacts with NetSuite Internal IDs`);
    
    // Verify import
    const totalContacts = await db.select().from(contacts);
    console.log(`📊 Total contacts in database: ${totalContacts.length}`);
    
    // Show sample contacts
    const sampleContacts = totalContacts.slice(0, 5);
    console.log('📋 Sample contacts:');
    sampleContacts.forEach(contact => {
      console.log(`   • ${contact.name} (ID: ${contact.netsuiteInternalId}) - ${contact.email || 'No email'}`);
    });
    
  } catch (error) {
    console.error('❌ Error importing contacts:', error);
    process.exit(1);
  }
}

// Run the import immediately
importContacts().then(() => {
  console.log('✅ Contact import completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Import failed:', error);
  process.exit(1);
});