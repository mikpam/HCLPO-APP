import { skuValidator } from './services/openai-sku-validator';

async function testSimpleSKU() {
  console.log('🧪 Testing Simple SKU Validation\n');

  // Wait for validator to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test with a simple two-item input
  const simpleInput = `
SKU: 1001-0000
Description: Jag Bag Red promotional bag
Quantity: 25
____
Description: Setup charge for artwork
Quantity: 1
`;

  console.log('📝 Input text:');
  console.log(simpleInput);
  console.log('\n🤖 Processing...\n');
  
  try {
    const results = await skuValidator.validateLineItems(simpleInput);
    
    console.log(`\n✅ Results: ${results.length} items processed`);
    
    results.forEach((item, index) => {
      console.log(`\n${index + 1}. "${item.sku}" → "${item.finalSKU}"`);
      console.log(`   Description: ${item.description}`);
      console.log(`   Quantity: ${item.quantity}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testSimpleSKU().catch(console.error);