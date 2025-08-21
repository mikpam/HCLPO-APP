#!/usr/bin/env node

/**
 * Import Fresh HCL Customers Script
 * 
 * This script:
 * 1. Backs up existing customer embeddings (to avoid re-generating them)
 * 2. Clears the customers table
 * 3. Converts the NetSuite XML export to CSV
 * 4. Imports the fresh customer data while preserving schema
 * 5. Restores embeddings where possible based on customer number matching
 */

import fs from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { customers } from '../shared/schema.js';
import { eq, sql } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

// Initialize database connection (same as server/db.ts)
const pool = new Pool({ 
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
const db = drizzle(pool);

async function parseNetSuiteXML(xmlFilePath) {
  console.log('📄 Parsing NetSuite XML export...');
  
  const xmlContent = fs.readFileSync(xmlFilePath, 'utf-8');
  const customers = [];
  
  // Extract rows using regex (simpler than full XML parsing)
  const rowMatches = xmlContent.match(/<Row>[\s\S]*?<\/Row>/g);
  
  if (!rowMatches) {
    throw new Error('No rows found in XML file');
  }

  // Skip header row
  const dataRows = rowMatches.slice(1);
  
  for (const row of dataRows) {
    const cells = row.match(/<Data ss:Type="[^"]*">([^<]*)<\/Data>/g) || [];
    const values = cells.map(cell => {
      const match = cell.match(/<Data ss:Type="[^"]*">([^<]*)<\/Data>/);
      return match ? match[1] : '';
    });
    
    if (values.length >= 17) { // Ensure we have all expected columns
      const customer = {
        netsuiteInternalId: values[0] || null,
        customerNumber: values[1] || null,
        companyName: values[2] || null,
        email: values[3] || null,
        phone: values[4] || null,
        officePhone: values[5] || null,
        fax: values[6] || null,
        primaryContact: values[7] || null,
        altEmail: values[8] || null,
        // Skip banking/payment fields (9-16) as they're not in our schema
      };
      
      // Only include customers with required fields
      if (customer.customerNumber && customer.companyName) {
        customers.push(customer);
      }
    }
  }
  
  console.log(`✅ Parsed ${customers.length} customer records from XML`);
  return customers;
}

async function backupExistingEmbeddings() {
  console.log('🔄 Backing up existing customer embeddings...');
  
  try {
    const existingCustomers = await db
      .select({
        customerNumber: customers.customerNumber,
        customerEmbedding: customers.customerEmbedding
      })
      .from(customers)
      .where(sql`customer_embedding IS NOT NULL`);
    
    const embeddingBackup = {};
    existingCustomers.forEach(customer => {
      if (customer.customerNumber && customer.customerEmbedding) {
        embeddingBackup[customer.customerNumber] = customer.customerEmbedding;
      }
    });
    
    // Save backup to file
    fs.writeFileSync(
      'scripts/customer-embeddings-backup.json', 
      JSON.stringify(embeddingBackup, null, 2)
    );
    
    console.log(`✅ Backed up ${Object.keys(embeddingBackup).length} customer embeddings`);
    return embeddingBackup;
  } catch (error) {
    console.error('❌ Error backing up embeddings:', error);
    return {};
  }
}

async function clearCustomersTable() {
  console.log('🗑️ Clearing existing customers table...');
  
  try {
    const result = await db.delete(customers);
    console.log(`✅ Cleared customers table`);
  } catch (error) {
    console.error('❌ Error clearing customers table:', error);
    throw error;
  }
}

async function importCustomers(customerData, embeddingBackup) {
  console.log(`📊 Importing ${customerData.length} customers...`);
  
  const batchSize = 100;
  let imported = 0;
  let embeddingsRestored = 0;
  
  for (let i = 0; i < customerData.length; i += batchSize) {
    const batch = customerData.slice(i, i + batchSize);
    
    const insertData = batch.map(customer => ({
      customerNumber: customer.customerNumber,
      companyName: customer.companyName,
      email: customer.email || null,
      phone: customer.phone || null,
      netsuiteId: customer.netsuiteInternalId || null,
      isActive: true,
      // Restore embedding if available
      customerEmbedding: embeddingBackup[customer.customerNumber] || null,
      // Create search vector from company name and customer number
      searchVector: `${customer.companyName} ${customer.customerNumber}`.toLowerCase(),
    }));
    
    try {
      await db.insert(customers).values(insertData);
      imported += batch.length;
      
      // Count restored embeddings in this batch
      const restoredInBatch = batch.filter(c => embeddingBackup[c.customerNumber]).length;
      embeddingsRestored += restoredInBatch;
      
      console.log(`✅ Imported batch ${Math.ceil((i + batchSize) / batchSize)} of ${Math.ceil(customerData.length / batchSize)} (${imported} total)`);
    } catch (error) {
      console.error(`❌ Error importing batch ${Math.ceil((i + batchSize) / batchSize)}:`, error);
      throw error;
    }
  }
  
  console.log(`✅ Import completed: ${imported} customers imported, ${embeddingsRestored} embeddings restored`);
  return { imported, embeddingsRestored };
}

async function validateImport() {
  console.log('🔍 Validating import...');
  
  try {
    const count = await db
      .select({ count: sql`count(*)` })
      .from(customers);
    
    const activeCount = await db
      .select({ count: sql`count(*)` })
      .from(customers)
      .where(eq(customers.isActive, true));
    
    const withEmbeddings = await db
      .select({ count: sql`count(*)` })
      .from(customers)
      .where(sql`customer_embedding IS NOT NULL`);
    
    console.log(`✅ Validation results:`);
    console.log(`   Total customers: ${count[0].count}`);
    console.log(`   Active customers: ${activeCount[0].count}`);
    console.log(`   With embeddings: ${withEmbeddings[0].count}`);
    
    return {
      total: parseInt(count[0].count),
      active: parseInt(activeCount[0].count),
      withEmbeddings: parseInt(withEmbeddings[0].count)
    };
  } catch (error) {
    console.error('❌ Error validating import:', error);
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting fresh HCL customers import...\n');
  
  try {
    // 1. Parse XML file
    const xmlFilePath = 'attached_assets/CustomerSearchResults131_1755734755366.xls';
    const customerData = await parseNetSuiteXML(xmlFilePath);
    
    // 2. Backup existing embeddings
    const embeddingBackup = await backupExistingEmbeddings();
    
    // 3. Clear existing customers
    await clearCustomersTable();
    
    // 4. Import fresh customer data
    const importStats = await importCustomers(customerData, embeddingBackup);
    
    // 5. Validate import
    const validation = await validateImport();
    
    console.log('\n🎉 Fresh customer import completed successfully!');
    console.log(`📊 Summary:`);
    console.log(`   Imported: ${importStats.imported} customers`);
    console.log(`   Embeddings restored: ${importStats.embeddingsRestored}`);
    console.log(`   Total in database: ${validation.total}`);
    console.log(`   Active customers: ${validation.active}`);
    console.log(`   With embeddings: ${validation.withEmbeddings}`);
    
    // Clean up backup file if import was successful
    if (fs.existsSync('scripts/customer-embeddings-backup.json')) {
      fs.unlinkSync('scripts/customer-embeddings-backup.json');
      console.log('🧹 Cleaned up temporary backup file');
    }
    
  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
main();