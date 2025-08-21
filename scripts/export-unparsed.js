import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { contacts } from '../shared/schema.ts';
import { isNull } from 'drizzle-orm';
import fs from 'fs';
import csvWriter from 'csv-writer';

const neonSql = neon(process.env.DATABASE_URL);
const db = drizzle(neonSql);

async function exportUnparsedContacts() {
  console.log('📊 EXPORT: Getting all unparsed contacts...');
  
  // Get all unparsed contacts
  const unparsedContacts = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      company: contacts.company,
      customer_number: contacts.customerNumber,
      company_name: contacts.companyName
    })
    .from(contacts)
    .where(isNull(contacts.customerNumber))
    .orderBy(contacts.company);

  console.log(`📋 Found ${unparsedContacts.length} unparsed contacts`);
  
  // Create CSV writer
  const writer = csvWriter.createObjectCsvWriter({
    path: './unparsed_contacts_export.csv',
    header: [
      { id: 'id', title: 'ID' },
      { id: 'name', title: 'Name' },
      { id: 'email', title: 'Email' },
      { id: 'company', title: 'Company (Original)' },
      { id: 'customer_number', title: 'Customer Number (Empty)' },
      { id: 'company_name', title: 'Company Name (Empty)' },
      { id: 'suggested_customer_number', title: 'Suggested Customer Number' },
      { id: 'suggested_company_name', title: 'Suggested Company Name' }
    ]
  });

  // Process each contact to suggest parsing
  const processedContacts = unparsedContacts.map(contact => {
    let suggestedCustomerNumber = '';
    let suggestedCompanyName = '';
    
    if (contact.company) {
      const company = contact.company.trim();
      
      // Pattern 1: "C100018 SPECIAL T'S"
      const standardPattern = /^(C\d+)\s+(.+)$/;
      const standardMatch = company.match(standardPattern);
      
      if (standardMatch) {
        suggestedCustomerNumber = standardMatch[1];
        suggestedCompanyName = standardMatch[2].trim();
      }
      // Pattern 2: "c1958 American Solutions for Business" (already handled by robust parser)
      else {
        const lowercasePattern = /^c(\d+)\s+(.+)$/i;
        const lowercaseMatch = company.match(lowercasePattern);
        
        if (lowercaseMatch) {
          suggestedCustomerNumber = `C${lowercaseMatch[1]}`;
          suggestedCompanyName = lowercaseMatch[2].trim();
        } else {
          // Just set the whole thing as company name if no pattern matches
          suggestedCompanyName = company;
        }
      }
    }
    
    return {
      ...contact,
      suggested_customer_number: suggestedCustomerNumber,
      suggested_company_name: suggestedCompanyName
    };
  });

  // Write CSV
  await writer.writeRecords(processedContacts);
  
  console.log('✅ CSV exported successfully to: unparsed_contacts_export.csv');
  console.log(`📊 Total unparsed contacts: ${processedContacts.length}`);
  
  // Show some statistics
  const withSuggestions = processedContacts.filter(c => c.suggested_customer_number);
  const withoutSuggestions = processedContacts.filter(c => !c.suggested_customer_number);
  
  console.log(`   ✅ With parsing suggestions: ${withSuggestions.length}`);
  console.log(`   ❓ Requiring manual review: ${withoutSuggestions.length}`);
}

exportUnparsedContacts().catch(console.error);