import fs from 'fs';
import path from 'path';
import { db } from '../db';
import { customers } from '../../shared/schema';

interface HCLCustomerRecord {
  internalId: string;
  customerNumber: string;
  companyName: string;
  email: string;
  phone: string;
  isActive: boolean;
  searchKey: string;
  emailDomain?: string;
  phoneDigits?: string;
  aliases?: string;
}

function parseCompleteCustomerFile(filePath: string): HCLCustomerRecord[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const sections = content.split('\n## CNumber: ').slice(1); // Remove header and split by customer sections
  
  const customers: HCLCustomerRecord[] = [];
  
  for (const section of sections) {
    try {
      const lines = section.split('\n');
      
      // Parse header line: "C606277 — CustomerName: L & S Uniforms dba United Apparel & Promos"
      const headerLine = lines[0];
      const cNumberMatch = headerLine.match(/^(C\d+)\s+—\s+CustomerName:\s+(.+)$/);
      
      if (!cNumberMatch) {
        console.log(`⚠️  Skipping malformed header: ${headerLine.substring(0, 50)}...`);
        continue;
      }
      
      const [, customerNumber, companyName] = cNumberMatch;
      
      // Parse data lines
      let email = '';
      let phone = '';
      let searchKey = '';
      let emailDomain = '';
      let phoneDigits = '';
      let aliases = '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('email: ')) {
          email = trimmed.replace('email: ', '').trim();
        } else if (trimmed.startsWith('email_domain: ')) {
          emailDomain = trimmed.replace('email_domain: ', '').trim();
        } else if (trimmed.startsWith('phone: ')) {
          phone = trimmed.replace('phone: ', '').trim();
        } else if (trimmed.startsWith('phone_digits: ')) {
          phoneDigits = trimmed.replace('phone_digits: ', '').trim();
        } else if (trimmed.startsWith('search_key: ')) {
          searchKey = trimmed.replace('search_key: ', '').trim();
        } else if (trimmed.startsWith('aliases: ')) {
          aliases = trimmed.replace('aliases: ', '').trim();
        }
      }
      
      // Generate a unique internal ID since we don't have one in this format
      const internalId = `HCL_${customerNumber}`;
      
      customers.push({
        internalId,
        customerNumber,
        companyName: companyName.trim(),
        email: email || '',
        phone: phone || '',
        isActive: true, // All customers in this list appear to be active
        searchKey,
        emailDomain,
        phoneDigits,
        aliases
      });
      
    } catch (error) {
      console.error(`❌ Error parsing customer section: ${section.substring(0, 100)}...`);
      console.error('   Error:', error instanceof Error ? error.message : String(error));
    }
  }
  
  return customers;
}

async function importCompleteHCLCustomers() {
  try {
    console.log('🚀 Starting complete HCL customer import...');
    
    const filePath = path.join(process.cwd(), 'attached_assets', 'hcl_customers_index_1755671087572.md');
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`Complete customer file not found: ${filePath}`);
    }
    
    console.log(`📁 Reading complete customer data from: ${filePath}`);
    const hclCustomers = parseCompleteCustomerFile(filePath);
    
    console.log(`📊 Found ${hclCustomers.length} customer records`);
    
    // Clear existing customers first
    console.log('🗑️  Clearing existing customers...');
    await db.delete(customers);
    console.log('✅ Existing customers cleared');
    
    let imported = 0;
    let errors = 0;
    
    // Process in batches of 500 for efficiency
    const batchSize = 500;
    const batches: HCLCustomerRecord[][] = [];
    
    for (let i = 0; i < hclCustomers.length; i += batchSize) {
      batches.push(hclCustomers.slice(i, i + batchSize));
    }
    
    console.log(`⚡ Processing ${batches.length} batches of ${batchSize} customers each...`);
    console.log('');
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const customersToInsert = [];
      
      for (const customer of batch) {
        // Convert to database format
        const customerData = {
          netsuiteId: customer.internalId,
          customerNumber: customer.customerNumber,
          companyName: customer.companyName,
          email: customer.email || null,
          phone: customer.phone || null,
          isActive: customer.isActive,
          // Store additional metadata in a structured way
          searchVector: customer.searchKey || customer.companyName.toLowerCase().replace(/[^a-z0-9]/g, ''),
        };
        
        customersToInsert.push(customerData);
      }
      
      // Insert batch
      try {
        await db.insert(customers).values(customersToInsert);
        imported += customersToInsert.length;
        console.log(`✅ Batch ${batchIndex + 1}/${batches.length}: Inserted ${customersToInsert.length} customers`);
      } catch (error) {
        console.error(`❌ Error inserting batch ${batchIndex + 1}:`, error.message);
        errors += customersToInsert.length;
      }
      
      // Progress reporting every 10 batches
      if ((batchIndex + 1) % 10 === 0) {
        console.log(`📊 Progress: ${imported} customers imported so far...`);
      }
    }
    
    console.log('\n📊 Import Summary:');
    console.log(`   ✅ Successfully imported: ${imported} customers`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📈 Total processed: ${imported + errors}`);
    
    // Sample imported customers
    console.log('\n🎯 Sample imported customers:');
    const sampleCustomers = await db.select().from(customers).limit(5);
    sampleCustomers.forEach((customer, index) => {
      console.log(`   ${index + 1}. ${customer.customerNumber}: ${customer.companyName}`);
      console.log(`      NetSuite ID: ${customer.netsuiteId} | Active: ${customer.isActive}`);
      if (customer.email) console.log(`      Email: ${customer.email}`);
    });
    
    const totalCustomers = await db.select().from(customers);
    console.log(`\n🎉 Complete HCL customer import finished! Total customers in database: ${totalCustomers.length}`);
    
  } catch (error) {
    console.error('❌ Import failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// Run the import
importCompleteHCLCustomers().catch(console.error);