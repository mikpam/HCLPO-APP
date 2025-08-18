// Test script for Red Swag PO customer lookup fix
import { OpenAICustomerFinderService } from './server/services/openai-customer-finder.js';

async function testRedSwagFix() {
  console.log('🧪 Testing Red Swag PO 250731-6730 customer lookup fix...');
  
  const customerFinder = new OpenAICustomerFinderService();
  const poId = '2d680d9a-c0ea-48b1-99fe-618a65d8367f'; // Red Swag PO ID
  
  try {
    console.log(`📋 Processing PO ID: ${poId}`);
    const result = await customerFinder.processPurchaseOrder(poId);
    
    if (result) {
      console.log('✅ Customer lookup completed successfully');
      console.log('📊 Result:', JSON.stringify(result, null, 2));
    } else {
      console.log('❌ Customer lookup failed');
    }
  } catch (error) {
    console.error('💥 Error during test:', error);
  }
}

testRedSwagFix().catch(console.error);