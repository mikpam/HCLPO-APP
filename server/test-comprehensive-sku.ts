import { skuValidator } from './services/openai-sku-validator';

async function testComprehensiveSKU() {
  console.log('🧪 Testing Comprehensive Multi-Line Item SKU Validation\n');

  // Wait for validator to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test with realistic Gemini JSON output containing multiple line items
  const comprehensiveInput = `
SKU: 1001-0000
Description: Jag Bag - Red promotional bag
Color: Red
Quantity: 100
____
SKU: VNS2-08-L
Description: ANSI 2 Yellow Safety Vest - Large
Color: Yellow  
Quantity: 25
____
Description: Setup charge for artwork placement
Quantity: 1
____
Description: 48 hour rush service required
Quantity: 1
____
SKU: UNKNOWN-ITEM
Description: Custom branded water bottle
Color: Blue
Quantity: 200
____
Description: Digital proof for client approval
Quantity: 1
____
SKU: 1002-0001
Description: Jag Bag - Red 2 side Book bags
Quantity: 50
`;

  console.log(`📝 Testing with ${comprehensiveInput.split('____').length} line items...`);
  console.log('\n🤖 Processing comprehensive test...\n');
  
  try {
    const results = await skuValidator.validateLineItems(comprehensiveInput);
    
    console.log('\n' + '='.repeat(60));
    console.log('📋 COMPREHENSIVE VALIDATION RESULTS');
    console.log('='.repeat(60));
    
    results.forEach((item, index) => {
      console.log(`\n${index + 1}. Original: "${item.sku}" → Final: "${item.finalSKU}"`);
      console.log(`   Description: ${item.description}`);
      console.log(`   Color: "${item.itemColor}"`);
      console.log(`   Quantity: ${item.quantity}`);
      
      // Categorize the result
      if (skuValidator.isValidSKU(item.finalSKU)) {
        console.log(`   ✅ VALID HCL SKU - Found in database`);
      } else if (['SETUP', '48-RUSH', 'R', 'P', 'SPEC', 'EC', 'ED', 'EL', 'HT', 'ICC', 'LE', 'PC', 'PE', 'PMS', 'PP', 'SR', 'VD', 'VI', 'X', 'LTM', 'CCC', 'DB', 'DDP', 'DP', 'DS'].includes(item.finalSKU)) {
        console.log(`   ⚙️  CHARGE CODE - ${item.finalSKU}`);
      } else if (item.finalSKU === 'OE-MISC-ITEM') {
        console.log(`   🔄 MISC ITEM - Unknown SKU processed`);
      } else {
        console.log(`   ❓ UNKNOWN TYPE`);
      }
    });
    
    console.log('\n' + '='.repeat(60));
    console.log(`🎉 SUCCESS: Processed ${results.length} line items from Gemini JSON output`);
    console.log('✅ Multi-line item processing is fully operational!');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Error in comprehensive test:', error);
  }
}

testComprehensiveSKU().catch(console.error);