/**
 * Import HCL customers from CSV file
 * This script will populate the customers table with customer data
 */

import { parse } from 'csv-parse';
import fs from 'fs';
import path from 'path';
import { db } from '../server/db';
import { customers } from '../shared/schema';
import { sql } from 'drizzle-orm';

interface CSVCustomer {
  CNumber: string;
  CustomerName: string;
  Email: string;
  email_norm: string;
  email_domain: string;
  Phone: string;
  phone_digits: string;
  ExternalID: string;
  search_key: string;
  root_name: string;
  aliases: string;
}

async function importHCLCustomers() {
  console.log('🔄 Starting HCL customer import...');
  
  try {
    // Read and parse the CSV file
    const csvPath = 'attached_assets/hcl_customers_index_1755406361046.csv';
    const csvData = fs.readFileSync(csvPath, 'utf-8');
    
    const csvCustomers: CSVCustomer[] = [];
    
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
          const customerNumber = r['CNumber']?.trim();
          const companyName = r['CustomerName']?.trim();
          
          // Only include customers with valid customer number and name
          if (customerNumber && companyName) {
            csvCustomers.push({
              CNumber: customerNumber,
              CustomerName: companyName,
              Email: r['Email']?.trim() || '',
              email_norm: r['email_norm']?.trim() || '',
              email_domain: r['email_domain']?.trim() || '',
              Phone: r['Phone']?.trim() || '',
              phone_digits: r['phone_digits']?.trim() || '',
              ExternalID: r['ExternalID']?.trim() || '',
              search_key: r['search_key']?.trim() || '',
              root_name: r['root_name']?.trim() || '',
              aliases: r['aliases']?.trim() || '',
            });
          }
        }
        resolve(undefined);
      });
    });

    console.log(`📊 Parsed ${csvCustomers.length} valid customers from CSV`);
    
    // Clear existing customers table
    console.log('🧹 Clearing existing customers table...');
    await db.delete(customers);
    
    // Insert customers in batches
    const batchSize = 100;
    let inserted = 0;
    
    for (let i = 0; i < csvCustomers.length; i += batchSize) {
      const batch = csvCustomers.slice(i, i + batchSize);
      
      const customerRecords = batch.map(customer => {
        // Parse aliases into alternate names array
        const alternateNames = customer.aliases 
          ? customer.aliases.split(' | ').filter(name => name && name !== customer.CustomerName)
          : [];
        
        return {
          customerNumber: customer.CNumber,
          companyName: customer.CustomerName,
          alternateNames: alternateNames.length > 0 ? alternateNames : null,
          email: customer.Email || null,
          phone: customer.Phone || null,
          phoneDigits: customer.phone_digits || null,
          netsuiteId: customer.ExternalID || null,
          address: null, // No address data in CSV
          isActive: true,
          searchVector: `${customer.CustomerName} ${customer.CNumber} ${customer.Email} ${customer.email_domain}`.toLowerCase(),
        };
      });
      
      await db.insert(customers).values(customerRecords);
      inserted += batch.length;
      
      console.log(`   ✅ Inserted batch ${Math.floor(i/batchSize) + 1}: ${inserted}/${csvCustomers.length} customers`);
    }
    
    // Get final count
    const [finalCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(customers);
    
    console.log(`\n✅ Customer import complete!`);
    console.log(`   📊 Total customers in database: ${finalCount.count}`);
    console.log(`   🎯 Important customers imported:`);
    
    // Check for specific customers mentioned by user
    const importantCustomers = ['geiger', 'ipromoteu'];
    for (const name of importantCustomers) {
      const [found] = await db
        .select({ 
          customerNumber: customers.customerNumber,
          companyName: customers.companyName 
        })
        .from(customers)
        .where(sql`LOWER(${customers.companyName}) LIKE ${`%${name}%`}`)
        .limit(1);
      
      if (found) {
        console.log(`      ✅ ${found.companyName} (${found.customerNumber})`);
      } else {
        console.log(`      ❌ ${name} - not found`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error importing customers:', error);
    process.exit(1);
  }
}

// Run the import
importHCLCustomers()
  .then(() => {
    console.log('\n🎉 Import process completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Import failed:', error);
    process.exit(1);
  });