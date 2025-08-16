import fs from 'fs';
import path from 'path';
import { db } from '../db';
import { customers } from '../../shared/schema';
import { eq } from 'drizzle-orm';

interface HCLCustomerRecord {
  internalId: string;
  customerNumber: string;
  companyName: string;
  email: string;
  phone: string;
  isActive: boolean;
}

function parseHCLCustomerFile(filePath: string): HCLCustomerRecord[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const customers: HCLCustomerRecord[] = [];
  
  // Skip header lines and process data
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('|---')) continue;
    
    // Parse markdown table row
    const columns = line.split('|').map(col => col.trim()).filter(col => col);
    
    if (columns.length >= 5) {
      const [internalId, customerNumber, companyName, email, phone] = columns;
      
      // Skip empty rows or malformed data
      if (!internalId || !customerNumber || !companyName) continue;
      
      // Determine if customer is active (not marked for deletion)
      const isActive = !customerNumber.includes('delete');
      
      // Clean customer number (remove 'delete' suffix)
      const cleanCustomerNumber = customerNumber.replace(/delete$/, '');
      
      customers.push({
        internalId,
        customerNumber: cleanCustomerNumber,
        companyName,
        email: email || '',
        phone: phone || '',
        isActive
      });
    }
  }
  
  return customers;
}

async function importHCLCustomers() {
  try {
    console.log('🔄 Starting HCL customer import...');
    
    const filePath = path.join(process.cwd(), 'attached_assets', 'HCLcustomers_1755362383728.md');
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`HCL customer file not found: ${filePath}`);
    }
    
    console.log(`📁 Reading customer data from: ${filePath}`);
    const hclCustomers = parseHCLCustomerFile(filePath);
    
    console.log(`📊 Found ${hclCustomers.length} customer records`);
    
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    
    for (const customer of hclCustomers) {
      try {
        // Check if customer already exists
        const existingCustomer = await db
          .select()
          .from(customers)
          .where(eq(customers.customerNumber, customer.customerNumber))
          .limit(1);
        
        if (existingCustomer.length > 0) {
          // Update existing customer
          await db
            .update(customers)
            .set({
              companyName: customer.companyName,
              email: customer.email,
              phone: customer.phone,
              netsuiteId: customer.internalId,
              isActive: customer.isActive,
              updatedAt: new Date()
            })
            .where(eq(customers.customerNumber, customer.customerNumber));
          
          updated++;
        } else {
          // Insert new customer
          await db.insert(customers).values({
            customerNumber: customer.customerNumber,
            companyName: customer.companyName,
            email: customer.email,
            phone: customer.phone,
            netsuiteId: customer.internalId,
            isActive: customer.isActive,
            alternateNames: [], // Can be populated later if needed
            searchVector: `${customer.companyName} ${customer.customerNumber}`.toLowerCase()
          });
          
          imported++;
        }
        
        // Log progress every 1000 records
        if ((imported + updated + skipped) % 1000 === 0) {
          console.log(`   Processed ${imported + updated + skipped} records...`);
        }
      } catch (error) {
        console.error(`❌ Error processing customer ${customer.customerNumber}:`, error);
        skipped++;
      }
    }
    
    console.log('\n✅ HCL Customer import completed!');
    console.log(`   📥 Imported: ${imported} new customers`);
    console.log(`   🔄 Updated: ${updated} existing customers`);
    console.log(`   ⚠️  Skipped: ${skipped} records with errors`);
    console.log(`   📊 Total processed: ${imported + updated + skipped}`);
    
    // Show some sample data
    const sampleCustomers = await db
      .select()
      .from(customers)
      .where(eq(customers.isActive, true))
      .limit(5);
    
    console.log('\n📋 Sample imported customers:');
    sampleCustomers.forEach(customer => {
      console.log(`   ${customer.customerNumber}: ${customer.companyName}`);
    });
    
  } catch (error) {
    console.error('❌ HCL customer import failed:', error);
    throw error;
  }
}

// Run import if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  importHCLCustomers()
    .then(() => {
      console.log('✅ Import completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Import failed:', error);
      process.exit(1);
    });
}

export { importHCLCustomers };