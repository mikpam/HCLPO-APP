import { skuValidator } from './services/openai-sku-validator';

async function testSKUValidator() {
  console.log('🧪 Testing OpenAI SKU Validator\n');

  // Wait a moment for the validator to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('📊 Validator Stats:', skuValidator.getStats());

  // Test input with line items separated by ____
  const testInput = `
Item 1:
SKU: T339-BL
Description: Blue polo shirt
Color: Blue
Quantity: 25
____
Item 2:
SKU: 1001-0000
Description: Jag Bag - Red promotional bag
Quantity: 100
____
Item 3:
Description: Setup charge for logo placement
Quantity: 1
____
Item 4:
SKU: UNKNOWN123
Description: Custom mug with handle
Color: White
Quantity: 50
____
Item 5:
Description: 48 hour rush service
Quantity: 1
____
Item 6:
SKU: VNS2-08-L
Description: ANSI 2 Yellow Safety Vest - Large
Color: Yellow
Quantity: 10
`;

  console.log('\n🔍 Testing with sample line items...\n');
  
  try {
    const results = await skuValidator.validateLineItems(testInput);
    
    console.log('\n📋 Validation Results:');
    console.log('='.repeat(50));
    
    results.forEach((item, index) => {
      console.log(`\n${index + 1}. Original SKU: "${item.sku}"`);
      console.log(`   Final SKU: "${item.finalSKU}"`);
      console.log(`   Description: ${item.description}`);
      console.log(`   Color: "${item.itemColor}"`);
      console.log(`   Quantity: ${item.quantity}`);
      
      // Check if it's a valid HCL SKU
      if (skuValidator.isValidSKU(item.finalSKU)) {
        console.log(`   ✅ Valid HCL SKU found in database`);
      } else if (['48-RUSH', 'SETUP', 'OE-MISC-ITEM', 'LTM', 'CCC', 'DB', 'DDP', 'DP', 'DS', 'EC', 'ED', 'EL', 'HT', 'ICC', 'LE', 'P', 'PC', 'PE', 'PMS', 'PP', 'R', 'SPEC', 'SR', 'VD', 'VI', 'X', 'SHIP-CHARGE', '3P-SHIPPING'].includes(item.finalSKU)) {
        console.log(`   ⚙️  Special code: ${item.finalSKU}`);
      } else {
        console.log(`   ❓ Unknown SKU type`);
      }
    });
    
    console.log('\n🎉 SKU Validator test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error testing SKU validator:', error);
  }
}

// Run the test
testSKUValidator().catch(console.error);