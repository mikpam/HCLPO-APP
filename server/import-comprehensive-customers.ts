import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';
import { db } from './db';
import { customers } from '@shared/schema';
import { eq } from 'drizzle-orm';

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

async function importComprehensiveCustomers() {
  console.log('🚀 Starting comprehensive HCL customer import...\n');

  try {
    // Read and parse CSV file
    const csvContent = readFileSync('attached_assets/hcl_customers_index_1755406361046.csv', 'utf-8');
    const records: CSVCustomer[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    console.log(`📊 Found ${records.length} customer records in comprehensive CSV\n`);

    // Get existing customers for comparison
    const existingCustomers = await db.select().from(customers);
    const existingCustomerNumbers = new Set(existingCustomers.map(c => c.customerNumber));
    
    console.log(`📋 Current database has ${existingCustomers.length} customers`);
    console.log(`📈 Will process ${records.length} comprehensive records\n`);

    let updatedCount = 0;
    let addedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // Process in batches to avoid overwhelming the database
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(records.length / batchSize)}`);

      for (const record of batch) {
        try {
          // Skip records without customer number
          if (!record.CNumber || !record.CustomerName) {
            console.log(`   ⚠️  Skipping invalid record: ${record.CNumber || 'NO_NUMBER'} - ${record.CustomerName || 'NO_NAME'}`);
            continue;
          }

          // Parse aliases into array (pipe-separated in CSV)
          const aliases = record.aliases ? 
            record.aliases.split(' | ').map(alias => alias.trim()).filter(alias => alias.length > 0) : 
            [];

          // Prepare customer data
          const customerData = {
            customerNumber: record.CNumber.trim(),
            companyName: record.CustomerName.trim(),
            alternateNames: aliases,
            email: record.Email?.trim() || null,
            phone: record.Phone?.trim() || null,
            address: null, // No address data in this CSV
            netsuiteId: record.ExternalID?.trim() || null,
            isActive: true,
            searchVector: null, // Will be updated if needed
            updatedAt: new Date()
          };

          if (existingCustomerNumbers.has(record.CNumber.trim())) {
            // Update existing customer with enhanced data
            await db
              .update(customers)
              .set(customerData)
              .where(eq(customers.customerNumber, record.CNumber.trim()));
            updatedCount++;
          } else {
            // Insert new customer
            await db
              .insert(customers)
              .values({
                ...customerData,
                createdAt: new Date()
              });
            addedCount++;
          }

        } catch (error) {
          errorCount++;
          const errorMsg = `Error processing ${record.CNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          console.log(`   ❌ ${errorMsg}`);
        }
      }

      // Progress update
      console.log(`   ✅ Batch completed. Progress: ${Math.min(i + batchSize, records.length)}/${records.length}\n`);
    }

    // Final summary
    console.log('\n🎯 COMPREHENSIVE CUSTOMER IMPORT SUMMARY');
    console.log('==========================================');
    console.log(`📊 Total records processed: ${records.length}`);
    console.log(`✅ New customers added: ${addedCount}`);
    console.log(`🔄 Existing customers updated: ${updatedCount}`);
    console.log(`❌ Errors encountered: ${errorCount}`);

    if (errors.length > 0) {
      console.log('\n❌ Error Details (showing first 10):');
      errors.slice(0, 10).forEach(error => console.log(`   ${error}`));
    }

    // Verify final count
    const finalCustomers = await db.select().from(customers);
    console.log(`\n🏁 Final customer database count: ${finalCustomers.length}`);
    console.log(`📈 Expected comprehensive total: ${records.length}`);
    
    if (finalCustomers.length >= records.length * 0.95) {
      console.log('✅ Import successful! Customer database is now comprehensive.');
    } else {
      console.log('⚠️  Import completed but some records may be missing. Review errors above.');
    }

  } catch (error) {
    console.error('💥 Critical error during import:', error);
    throw error;
  }
}

// Run the import
importComprehensiveCustomers()
  .then(() => {
    console.log('\n🎉 Comprehensive customer import completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Import failed:', error);
    process.exit(1);
  });