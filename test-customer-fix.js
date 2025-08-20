// Direct test of customer lookup fallback logic
const { OpenAICustomerFinderService } = require('./server/services/openai-customer-finder.ts');

console.log('🧪 Testing Red Swag customer lookup with fallback logic...');

// Simulate the Red Swag PO data structure
const mockCustomerInput = {
  customerEmail: 'mromano@redswag.com',
  senderEmail: 'Megan Romano <mromano@redswag.com>',
  customerName: 'redswag',
  asiNumber: '',
  ppaiNumber: '',
  address: ''
};

console.log('📋 Testing with input:', JSON.stringify(mockCustomerInput, null, 2));

async function testCustomerLookup() {
  try {
    const service = new OpenAICustomerFinderService();
    const result = await service.findCustomer(mockCustomerInput);
    console.log('✅ Customer lookup result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testCustomerLookup();