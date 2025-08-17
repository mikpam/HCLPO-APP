import { openaiCustomerFinderService } from './services/openai-customer-finder';

async function testWithRealCustomer() {
  console.log('🧪 Testing OpenAI Customer Finder with real HCL customer\n');
  
  // Test with Beacon Sales and Marketing (from our previous query results)
  const testInput = {
    customerEmail: undefined,
    senderEmail: 'test@example.com',
    customerName: 'Beacon Sales and Marketing',
    asiNumber: undefined,
    ppaiNumber: undefined,
    address: undefined
  };
  
  console.log('Test Input:', testInput);
  console.log('\n🔍 Running OpenAI customer finder...\n');
  
  try {
    const result = await openaiCustomerFinderService.findCustomer(testInput);
    
    console.log('\n✅ Real Customer Test Result:');
    console.log('  Customer Number:', result?.customer_number || 'N/A');
    console.log('  Customer Name:', result?.customer_name || 'N/A');
    console.log('  Expected: C97698 - Beacon Sales and Marketing');
    console.log('  Match Found:', result?.customer_number ? 'YES' : 'NO');
    
    if (result?.customer_number === 'C97698') {
      console.log('\n🎉 SUCCESS: OpenAI customer finder correctly identified real customer!');
    } else if (result?.customer_number) {
      console.log('\n⚠️  OpenAI found a different customer than expected');
    } else {
      console.log('\n📋 No match found - may indicate search needs adjustment');
    }
    
  } catch (error) {
    console.error('\n❌ Error testing real customer:', error);
  }
}

testWithRealCustomer();