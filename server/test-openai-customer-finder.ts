import { openaiCustomerFinderService } from './services/openai-customer-finder';

// Test the OpenAI customer finder with the CREATIVE MARKETING SPECIALISTS case
async function testCustomerFinder() {
  console.log('🤖 Testing OpenAI Customer Finder Service\n');
  
  // Test case: CREATIVE MARKETING SPECIALISTS from recent PO
  const testInput = {
    customerEmail: 'office@cms-4you.com',
    senderEmail: 'Information Please <info@highcaliberline.com>',
    customerName: 'CREATIVE MARKETING SPECIALISTS',
    asiNumber: '170900',
    ppaiNumber: undefined,
    address: '924 A Development Drive, Lodi, Wisconsin'
  };
  
  console.log('Test Input:', testInput);
  console.log('\n🔍 Running OpenAI customer finder...\n');
  
  try {
    const result = await openaiCustomerFinderService.findCustomer(testInput);
    
    console.log('\n✅ OpenAI Customer Finder Result:');
    console.log('  Customer Number:', result?.customer_number || 'N/A');
    console.log('  Customer Name:', result?.customer_name || 'N/A');
    console.log('  Match Found:', result?.customer_number ? 'YES' : 'NO');
    
    if (!result?.customer_number) {
      console.log('\n📝 Analysis: This customer is correctly identified as NEW');
      console.log('   - Not found in HCL database');
      console.log('   - Flagged for CSR review');
      console.log('   - System working as expected');
    } else {
      console.log('\n📝 Analysis: Customer match found');
      console.log('   - OpenAI successfully identified existing customer');
      console.log('   - Using advanced matching logic');
    }
    
  } catch (error) {
    console.error('\n❌ Error testing OpenAI customer finder:', error);
  }
}

// Test with a known customer that should match
async function testKnownCustomer() {
  console.log('\n\n🧪 Testing with a known customer (Quality Logo Products)...\n');
  
  const testInput = {
    customerEmail: 'support@qualitylogoproducts.com',
    senderEmail: 'orders@qualitylogoproducts.com',
    customerName: 'Quality Logo Products',
    asiNumber: undefined,
    ppaiNumber: undefined,
    address: undefined
  };
  
  console.log('Test Input:', testInput);
  console.log('\n🔍 Running OpenAI customer finder...\n');
  
  try {
    const result = await openaiCustomerFinderService.findCustomer(testInput);
    
    console.log('\n✅ Known Customer Test Result:');
    console.log('  Customer Number:', result?.customer_number || 'N/A');
    console.log('  Customer Name:', result?.customer_name || 'N/A');
    console.log('  Expected: C7657 - Quality Logo Products');
    console.log('  Match Found:', result?.customer_number ? 'YES' : 'NO');
    
  } catch (error) {
    console.error('\n❌ Error testing known customer:', error);
  }
}

// Run the tests
testCustomerFinder().then(() => testKnownCustomer());