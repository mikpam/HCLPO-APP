import { OpenAICustomerFinderService } from './services/openai-customer-finder';

const customerFinder = new OpenAICustomerFinderService();

async function testRiversCustomer() {
  console.log('🧪 Testing Rivers Advertising LLC Customer Lookup\n');

  // Wait for customer finder to initialize  
  await new Promise(resolve => setTimeout(resolve, 2000));

  const testCases = [
    {
      description: "Rivers Advertising LLC - exact match",
      customerName: "Rivers Advertising LLC",
      expectedC: "C7869"
    },
    {
      description: "Rivers Advertising - partial match", 
      customerName: "Rivers Advertising",
      expectedC: "C7869"
    },
    {
      description: "RIVERS ADVERTISING LLC - case insensitive",
      customerName: "RIVERS ADVERTISING LLC", 
      expectedC: "C7869"
    }
  ];

  for (const testCase of testCases) {
    console.log(`🔍 Testing: ${testCase.description}`);
    console.log(`   Input: "${testCase.customerName}"`);
    
    try {
      const result = await customerFinder.findCustomer({
        customerName: testCase.customerName,
        senderEmail: "test@riversadvertising.com",
        customerEmail: "test@riversadvertising.com"
      });

      if (result && result.customer_number === testCase.expectedC) {
        console.log(`   ✅ SUCCESS: Found ${result.customer_number} - ${result.customer_name}`);
      } else if (result) {
        console.log(`   ❌ MISMATCH: Found ${result.customer_number} - ${result.customer_name}, expected ${testCase.expectedC}`);
      } else {
        console.log(`   ❌ NOT FOUND: Expected ${testCase.expectedC}`);
      }
    } catch (error) {
      console.log(`   ❌ ERROR: ${error}`);
    }
    console.log('');
  }

  console.log('🎯 Rivers Advertising LLC (C7869) should now be findable by the customer matcher!');
}

testRiversCustomer().catch(console.error);