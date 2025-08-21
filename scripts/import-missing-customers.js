#!/usr/bin/env node

/**
 * Import Missing Customers Script
 * 
 * Imports the 1,219 missing customers from the provided CSV file
 * Maps to the existing customer database schema with proper data cleaning
 */

import fs from 'fs';
import { parse } from 'csv-parse';
import { neon } from '@neondatabase/serverless';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database connection
const sql = neon(process.env.DATABASE_URL);

// CSV file path
const CSV_FILE_PATH = path.join(__dirname, '../attached_assets/Missing HCL  - update _1755747743340.csv');

/**
 * Parse address HTML to extract address components
 */
function parseAddress(addressHtml) {
  if (!addressHtml || addressHtml.trim() === '') return null;
  
  // Remove HTML tags and normalize
  const cleanAddress = addressHtml
    .replace(/<br>/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
  
  const lines = cleanAddress.split('\n').map(line => line.trim()).filter(line => line);
  
  if (lines.length === 0) return null;
  
  // Try to identify city, state, zip from last line
  const lastLine = lines[lines.length - 1];
  let city, state, zip, country;
  
  // Check if it ends with "United States"
  if (lastLine.includes('United States')) {
    country = 'United States';
    const withoutCountry = lastLine.replace('United States', '').trim();
    
    // Try to extract zip code (5 digits or 5+4 format)
    const zipMatch = withoutCountry.match(/(\d{5}(?:-\d{4})?)\s*$/);
    if (zipMatch) {
      zip = zipMatch[1];
      const withoutZip = withoutCountry.replace(zipMatch[0], '').trim();
      
      // Extract state (2 letter abbreviation before zip)
      const stateMatch = withoutZip.match(/([A-Z]{2})\s*$/);
      if (stateMatch) {
        state = stateMatch[1];
        city = withoutZip.replace(stateMatch[0], '').trim();
      }
    }
  }
  
  // Build address object
  const addressLines = lines.slice(0, -1); // All except last line (which has city/state/zip)
  
  return {
    street: addressLines.join(', '),
    city: city || '',
    state: state || '',
    postalCode: zip || '',
    country: country || 'United States'
  };
}

/**
 * Normalize customer number to ensure consistent format
 */
function normalizeCustomerNumber(cnumber) {
  if (!cnumber) return null;
  
  // Convert to uppercase and ensure it starts with C
  const normalized = cnumber.toString().toUpperCase().trim();
  if (normalized.startsWith('C')) {
    return normalized;
  }
  return `C${normalized}`;
}

/**
 * Generate alternate names for better matching
 */
function generateAlternateNames(companyName, altName) {
  const alternates = [];
  
  if (altName && altName.trim() && altName !== companyName) {
    alternates.push(altName.trim());
  }
  
  // Add common variations
  if (companyName) {
    // Remove common suffixes for variations
    const withoutSuffixes = companyName
      .replace(/\s+(Inc\.?|LLC\.?|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|Limited)$/i, '')
      .trim();
    
    if (withoutSuffixes !== companyName) {
      alternates.push(withoutSuffixes);
    }
    
    // Add with & without "The" prefix
    if (companyName.toLowerCase().startsWith('the ')) {
      alternates.push(companyName.substring(4));
    } else if (!companyName.toLowerCase().startsWith('the ')) {
      alternates.push(`The ${companyName}`);
    }
  }
  
  return [...new Set(alternates)]; // Remove duplicates
}

/**
 * Normalize phone number to extract digits only
 */
function normalizePhoneDigits(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

/**
 * Main import function
 */
async function importMissingCustomers() {
  console.log('🚀 MISSING CUSTOMERS IMPORT: Starting import process...');
  console.log(`📄 Reading CSV file: ${CSV_FILE_PATH}`);
  
  if (!fs.existsSync(CSV_FILE_PATH)) {
    console.error('❌ CSV file not found:', CSV_FILE_PATH);
    process.exit(1);
  }
  
  const records = [];
  let totalLines = 0;
  let skippedLines = 0;
  let importedCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;
  
  // Parse CSV
  const parser = parse({
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
  
  const csvData = fs.readFileSync(CSV_FILE_PATH, 'utf8');
  
  try {
    const allRecords = await new Promise((resolve, reject) => {
      const results = [];
      parser.write(csvData);
      parser.on('readable', function() {
        let record;
        while (record = parser.read()) {
          results.push(record);
        }
      });
      parser.on('error', reject);
      parser.on('end', () => resolve(results));
      parser.end();
    });
    
    console.log(`📊 Found ${allRecords.length} customer records in CSV`);
    
    // Process each record
    for (const record of allRecords) {
      totalLines++;
      
      try {
        const customerNumber = normalizeCustomerNumber(record['CNumber']);
        const companyName = record['Customer']?.trim();
        const netsuiteId = record['NEtsuite ID ']?.trim();
        const email = record['email']?.trim() || null;
        const phone = record['phone']?.trim() || null;
        const altName = record['Alt name']?.trim();
        const addressHtml = record['Address'];
        
        // Validate required fields
        if (!customerNumber || !companyName) {
          console.log(`⚠️  Skipping record ${totalLines}: Missing required fields (customerNumber: ${customerNumber}, companyName: ${companyName})`);
          skippedLines++;
          continue;
        }
        
        // Check if customer already exists
        const existingCustomer = await sql`
          SELECT customer_number FROM customers 
          WHERE customer_number = ${customerNumber}
        `;
        
        if (existingCustomer.length > 0) {
          console.log(`🔄 Customer ${customerNumber} already exists, skipping...`);
          duplicateCount++;
          continue;
        }
        
        // Parse address
        const address = parseAddress(addressHtml);
        
        // Generate alternate names
        const alternateNames = generateAlternateNames(companyName, altName);
        
        // Normalize phone digits
        const phoneDigits = normalizePhoneDigits(phone);
        
        // Prepare customer record
        const customerData = {
          customerNumber,
          companyName,
          alternateNames: alternateNames.length > 0 ? alternateNames : null,
          email: email || null,
          phone: phone || null,
          phoneDigits,
          address: address || null,
          netsuiteId: netsuiteId || null,
          isActive: true
        };
        
        // Insert customer
        await sql`
          INSERT INTO customers (
            customer_number,
            company_name,
            alternate_names,
            email,
            phone,
            phone_digits,
            address,
            netsuite_id,
            is_active
          ) VALUES (
            ${customerData.customerNumber},
            ${customerData.companyName},
            ${customerData.alternateNames},
            ${customerData.email},
            ${customerData.phone},
            ${customerData.phoneDigits},
            ${customerData.address},
            ${customerData.netsuiteId},
            ${customerData.isActive}
          )
        `;
        
        importedCount++;
        
        if (importedCount % 100 === 0) {
          console.log(`✅ Progress: ${importedCount} customers imported...`);
        }
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing record ${totalLines}:`, error.message);
        console.error(`   Record data:`, record);
      }
    }
    
    console.log('\n🎉 IMPORT COMPLETE!');
    console.log(`📊 FINAL STATISTICS:`);
    console.log(`   └─ Total records processed: ${totalLines}`);
    console.log(`   └─ Successfully imported: ${importedCount}`);
    console.log(`   └─ Duplicates skipped: ${duplicateCount}`);
    console.log(`   └─ Invalid records skipped: ${skippedLines}`);
    console.log(`   └─ Errors encountered: ${errorCount}`);
    
    // Verify final customer count
    const finalCount = await sql`SELECT COUNT(*) as count FROM customers`;
    console.log(`   └─ Total customers in database: ${finalCount[0].count}`);
    
    if (importedCount > 0) {
      console.log('\n✨ Import successful! New customers have been added to the database.');
      console.log('📋 Next steps:');
      console.log('   1. Run customer embedding generation for new customers');
      console.log('   2. Verify customer data in the admin portal');
    }
    
  } catch (error) {
    console.error('❌ FATAL ERROR during import:', error);
    process.exit(1);
  }
}

// Run the import
if (import.meta.url === `file://${process.argv[1]}`) {
  importMissingCustomers().catch(console.error);
}

export { importMissingCustomers };