import { db } from '../server/db';
import { purchaseOrders } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { HybridCustomerValidator } from '../server/services/hybrid-customer-validator';
import { OpenAIContactValidatorService } from '../server/services/openai-contact-validator';
import { OpenAISKUValidatorService } from '../server/services/openai-sku-validator';

async function revalidatePO(poId: string) {
  console.log(`\n🔄 REVALIDATING PO: ${poId}\n`);
  
  try {
    // Fetch the PO
    const [po] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, poId))
      .limit(1);
    
    if (!po) {
      console.error(`❌ PO not found: ${poId}`);
      return;
    }
    
    console.log(`📄 PO Number: ${po.poNumber}`);
    console.log(`📅 Created: ${po.createdAt}`);
    console.log(`📊 Current Status: ${po.status}`);
    
    const extractedData = po.extractedData as any;
    if (!extractedData) {
      console.error('❌ No extracted data found');
      return;
    }
    
    // Initialize validators
    const customerValidator = new HybridCustomerValidator();
    const contactValidator = new OpenAIContactValidatorService();
    const skuValidator = new OpenAISKUValidatorService();
    
    // Step 1: Validate Customer
    console.log('\n🏢 VALIDATING CUSTOMER...');
    const customerInput = {
      customerName: extractedData.purchaseOrder?.customer?.company,
      customerEmail: extractedData.purchaseOrder?.customer?.email,
      senderEmail: po.sender,
      senderDomain: po.sender?.split('@')[1]
    };
    
    const customerResult = await customerValidator.validateCustomer(customerInput);
    console.log(`   Result: ${customerResult.matched ? '✅ FOUND' : '❌ NOT FOUND'}`);
    console.log(`   Method: ${customerResult.method}`);
    console.log(`   Customer: ${customerResult.customerName} (${customerResult.customerNumber})`);
    console.log(`   Confidence: ${customerResult.confidence}`);
    
    // Step 2: Validate Contact
    console.log('\n👤 VALIDATING CONTACT...');
    const contactInput = {
      extractedData: extractedData,
      senderName: extractedData.purchaseOrder?.contact?.name || po.sender?.split('<')[0]?.trim(),
      senderEmail: extractedData.purchaseOrder?.contact?.email || po.sender,
      resolvedCustomerId: customerResult.customerNumber,
      companyId: customerResult.customerNumber
    };
    
    const contactResult = await contactValidator.validateContact(contactInput);
    console.log(`   Name: ${contactResult.name}`);
    console.log(`   Email: ${contactResult.email}`);
    console.log(`   Method: ${contactResult.match_method}`);
    console.log(`   Confidence: ${contactResult.confidence}`);
    
    // Step 3: Validate SKUs
    console.log('\n📦 VALIDATING SKUs...');
    const lineItems = extractedData.purchaseOrder?.lineItems || [];
    if (lineItems.length > 0) {
      const skuResults = await skuValidator.validateLineItems(lineItems);
      console.log(`   Total items: ${skuResults.length}`);
      for (const item of skuResults) {
        console.log(`   - ${item.sku} → ${item.finalSKU} (${item.validationNotes})`);
      }
    }
    
    // Update PO with validation results
    console.log('\n💾 UPDATING PO WITH VALIDATION RESULTS...');
    await db.update(purchaseOrders)
      .set({
        customerMeta: {
          status: customerResult.matched ? 'found' : 'not_found',
          method: customerResult.method,
          confidence: customerResult.confidence,
          customer_name: customerResult.customerName,
          customer_number: customerResult.customerNumber
        },
        contactMeta: {
          status: contactResult.matched_contact_id ? 'found' : 'not_found',
          method: contactResult.match_method,
          confidence: contactResult.confidence,
          contact_name: contactResult.name,
          contact_email: contactResult.email,
          resolved: !!contactResult.matched_contact_id
        }
      })
      .where(eq(purchaseOrders.id, poId));
    
    console.log('\n✅ PO REVALIDATION COMPLETE\n');
    
  } catch (error) {
    console.error('❌ Revalidation failed:', error);
  }
  
  process.exit(0);
}

// Run with the specific PO ID
const poId = process.argv[2] || '2c36123f-bdad-46c5-ba5f-9f0fccdd1aa1';
revalidatePO(poId);