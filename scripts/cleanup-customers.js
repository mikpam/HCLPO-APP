#!/usr/bin/env node

/**
 * Customer Database Cleanup Script
 * 
 * This script removes customers with:
 * 1. Prefixes/suffixes containing "old", "donotuse"
 * 2. Customer numbers that don't conform to C+number pattern (e.g., C12345)
 */

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

async function identifyCustomersToRemove() {
  console.log('🔍 Identifying customers to remove...');
  
  try {
    // Find customers with "old", "donotuse" in customer_number or company_name
    const invalidPatternsQuery = `
      SELECT customer_number, company_name, netsuite_id
      FROM customers 
      WHERE 
        LOWER(customer_number) LIKE '%old%' OR
        LOWER(customer_number) LIKE '%donotuse%' OR
        LOWER(company_name) LIKE '%old%' OR
        LOWER(company_name) LIKE '%donotuse%' OR
        customer_number !~ '^C[0-9]+$'
      ORDER BY customer_number
    `;
    
    const result = await pool.query(invalidPatternsQuery);
    
    console.log(`📋 Found ${result.rows.length} customers to remove:`);
    
    // Group by removal reason
    const oldCustomers = result.rows.filter(row => 
      row.customer_number.toLowerCase().includes('old') || 
      row.company_name.toLowerCase().includes('old')
    );
    
    const donotUseCustomers = result.rows.filter(row => 
      row.customer_number.toLowerCase().includes('donotuse') || 
      row.company_name.toLowerCase().includes('donotuse')
    );
    
    const invalidPatternCustomers = result.rows.filter(row => 
      !row.customer_number.match(/^C[0-9]+$/)
    );
    
    console.log(`   - "old" customers: ${oldCustomers.length}`);
    console.log(`   - "donotuse" customers: ${donotUseCustomers.length}`);
    console.log(`   - Invalid pattern customers: ${invalidPatternCustomers.length}`);
    
    // Show examples
    if (oldCustomers.length > 0) {
      console.log(`\n📝 Examples of "old" customers:`);
      oldCustomers.slice(0, 5).forEach(customer => {
        console.log(`   - ${customer.customer_number}: ${customer.company_name}`);
      });
    }
    
    if (donotUseCustomers.length > 0) {
      console.log(`\n📝 Examples of "donotuse" customers:`);
      donotUseCustomers.slice(0, 5).forEach(customer => {
        console.log(`   - ${customer.customer_number}: ${customer.company_name}`);
      });
    }
    
    if (invalidPatternCustomers.length > 0) {
      console.log(`\n📝 Examples of invalid pattern customers:`);
      invalidPatternCustomers.slice(0, 5).forEach(customer => {
        console.log(`   - ${customer.customer_number}: ${customer.company_name}`);
      });
    }
    
    return result.rows;
  } catch (error) {
    console.error('❌ Error identifying customers to remove:', error);
    throw error;
  }
}

async function removeInvalidCustomers(customersToRemove) {
  if (customersToRemove.length === 0) {
    console.log('✅ No customers need to be removed');
    return { removed: 0 };
  }
  
  console.log(`\n🗑️ Removing ${customersToRemove.length} invalid customers...`);
  
  try {
    // Build WHERE clause with customer numbers to remove
    const customerNumbers = customersToRemove.map(c => c.customer_number);
    const placeholders = customerNumbers.map((_, index) => `$${index + 1}`).join(', ');
    
    const deleteQuery = `
      DELETE FROM customers 
      WHERE customer_number IN (${placeholders})
    `;
    
    const result = await pool.query(deleteQuery, customerNumbers);
    
    console.log(`✅ Successfully removed ${result.rowCount} customers`);
    return { removed: result.rowCount };
  } catch (error) {
    console.error('❌ Error removing customers:', error);
    throw error;
  }
}

async function validateCleanup() {
  console.log('\n🔍 Validating cleanup...');
  
  try {
    // Count remaining customers
    const totalResult = await pool.query('SELECT count(*) as count FROM customers');
    
    // Check for remaining invalid patterns
    const invalidResult = await pool.query(`
      SELECT count(*) as count FROM customers 
      WHERE 
        LOWER(customer_number) LIKE '%old%' OR
        LOWER(customer_number) LIKE '%donotuse%' OR
        LOWER(company_name) LIKE '%old%' OR
        LOWER(company_name) LIKE '%donotuse%' OR
        customer_number !~ '^C[0-9]+$'
    `);
    
    // Check pattern conformity
    const validPatternResult = await pool.query(`
      SELECT count(*) as count FROM customers 
      WHERE customer_number ~ '^C[0-9]+$'
    `);
    
    const total = parseInt(totalResult.rows[0].count);
    const invalid = parseInt(invalidResult.rows[0].count);
    const validPattern = parseInt(validPatternResult.rows[0].count);
    
    console.log(`✅ Cleanup validation results:`);
    console.log(`   Total customers remaining: ${total}`);
    console.log(`   Invalid customers remaining: ${invalid}`);
    console.log(`   Valid C+number pattern: ${validPattern}`);
    console.log(`   Pattern conformity: ${((validPattern / total) * 100).toFixed(1)}%`);
    
    return { total, invalid, validPattern };
  } catch (error) {
    console.error('❌ Error validating cleanup:', error);
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting customer database cleanup...\n');
  
  try {
    // 1. Identify customers to remove
    const customersToRemove = await identifyCustomersToRemove();
    
    // 2. Remove invalid customers
    const removalStats = await removeInvalidCustomers(customersToRemove);
    
    // 3. Validate cleanup
    const validation = await validateCleanup();
    
    console.log('\n🎉 Customer database cleanup completed successfully!');
    console.log(`📊 Summary:`);
    console.log(`   Customers removed: ${removalStats.removed}`);
    console.log(`   Customers remaining: ${validation.total}`);
    console.log(`   Invalid customers remaining: ${validation.invalid}`);
    console.log(`   Pattern conformity: ${((validation.validPattern / validation.total) * 100).toFixed(1)}%`);
    
    if (validation.invalid === 0) {
      console.log('✅ All customers now conform to valid patterns!');
    } else {
      console.log(`⚠️  ${validation.invalid} customers still need review`);
    }
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
main();