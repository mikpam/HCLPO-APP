#!/usr/bin/env node

/**
 * Simple Fresh HCL Customers Import Script
 * 
 * This script:
 * 1. Backs up existing customer embeddings
 * 2. Clears the customers table
 * 3. Parses the NetSuite XML export
 * 4. Imports fresh customer data with proper schema mapping
 * 5. Restores embeddings where possible
 */

import fs from 'fs';
import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

// Initialize database connection
const pool = new Pool({ 
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function parseNetSuiteXML(xmlFilePath) {
  console.log('📄 Parsing NetSuite XML export...');
  
  const xmlContent = fs.readFileSync(xmlFilePath, 'utf-8');
  const customers = [];
  
  // Extract rows using regex
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
    const result = await pool.query(`
      SELECT customer_number, customer_embedding 
      FROM customers 
      WHERE customer_embedding IS NOT NULL
    `);
    
    const embeddingBackup = {};
    result.rows.forEach(row => {
      if (row.customer_number && row.customer_embedding) {
        embeddingBackup[row.customer_number] = row.customer_embedding;
      }
    });
    
    // Save backup to file
    fs.writeFileSync(
      'customer-embeddings-backup.json', 
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
    const result = await pool.query('DELETE FROM customers');
    console.log(`✅ Cleared customers table (${result.rowCount} rows deleted)`);
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
    
    // Build INSERT query with multiple VALUES
    const placeholders = [];
    const values = [];
    let paramIndex = 1;
    
    for (const customer of batch) {
      const customerEmbedding = embeddingBackup[customer.customerNumber] || null;
      const searchVector = `${customer.companyName} ${customer.customerNumber}`.toLowerCase();
      
      placeholders.push(`(gen_random_uuid(), $${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, NOW(), NOW())`);
      
      values.push(
        customer.customerNumber,     // $1, $9, etc.
        customer.companyName,        // $2, $10, etc.
        customer.email,              // $3, $11, etc.
        customer.phone,              // $4, $12, etc.
        customer.netsuiteInternalId, // $5, $13, etc.
        true,                        // is_active: $6, $14, etc.
        searchVector,                // search_vector: $7, $15, etc.
        customerEmbedding            // customer_embedding: $8, $16, etc.
      );
      
      paramIndex += 8;
      
      if (customerEmbedding) {
        embeddingsRestored++;
      }
    }
    
    const query = `
      INSERT INTO customers (
        id, customer_number, company_name, email, phone, 
        netsuite_id, is_active, search_vector, customer_embedding,
        created_at, updated_at
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (customer_number) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        netsuite_id = EXCLUDED.netsuite_id,
        search_vector = EXCLUDED.search_vector,
        updated_at = NOW()
    `;
    
    try {
      await pool.query(query, values);
      imported += batch.length;
      
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
    const countResult = await pool.query('SELECT count(*) as count FROM customers');
    const activeResult = await pool.query('SELECT count(*) as count FROM customers WHERE is_active = true');
    const embeddingResult = await pool.query('SELECT count(*) as count FROM customers WHERE customer_embedding IS NOT NULL');
    
    const total = parseInt(countResult.rows[0].count);
    const active = parseInt(activeResult.rows[0].count);
    const withEmbeddings = parseInt(embeddingResult.rows[0].count);
    
    console.log(`✅ Validation results:`);
    console.log(`   Total customers: ${total}`);
    console.log(`   Active customers: ${active}`);
    console.log(`   With embeddings: ${withEmbeddings}`);
    
    return { total, active, withEmbeddings };
  } catch (error) {
    console.error('❌ Error validating import:', error);
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting fresh HCL customers import...\n');
  
  try {
    // 1. Parse XML file
    const xmlFilePath = '../attached_assets/CustomerSearchResults131_1755734755366.xls';
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
    if (fs.existsSync('customer-embeddings-backup.json')) {
      fs.unlinkSync('customer-embeddings-backup.json');
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