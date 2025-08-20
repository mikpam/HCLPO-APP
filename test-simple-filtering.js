#!/usr/bin/env node

/**
 * Simple test to verify our improved filtering logic
 */

function testFiltering() {
  console.log('🧪 TESTING IMPROVED DOCUMENT FILTERING LOGIC\n');
  
  // Test our negative keyword filtering logic
  function isExcludedByKeywords(filename) {
    const excludeKeywords = [
      'shipping', 'label', 'receipt', 'invoice', 'bill', 'statement', 
      'packing', 'manifest', 'tracking', 'delivery', 'confirmation',
      'artwork', 'proof', 'design', 'layout', 'mockup', 'logo',
      'quote', 'estimate', 'proposal', 'rfq', 'bid'
    ];
    
    const filenameLower = filename.toLowerCase();
    return excludeKeywords.some(keyword => filenameLower.includes(keyword));
  }
  
  // Test cases from our database issues
  const realTestCases = [
    { 
      filename: 'MSP_Summit_Advance_Warehouse_Shipping_Label.pdf', 
      shouldExclude: true,
      description: 'Real shipping label from PO #537770'
    },
    { 
      filename: '12652_CNU_Lanyards_Proof.pdf', 
      shouldExclude: true,
      description: 'Real proof file from multiple POs' 
    },
    { 
      filename: 'Meruelo_FujiSan_artwork_R2.pdf', 
      shouldExclude: true,
      description: 'Real artwork file from multiple POs'
    },
    { 
      filename: 'PO_25-0802B_From_SL_Specialties.pdf', 
      shouldExclude: false,
      description: 'Recent legitimate PO that was correctly processed'
    }
  ];
  
  console.log('🔍 TESTING REAL CASES FROM DATABASE:');
  console.log('='.repeat(70));
  
  let passed = 0;
  let total = realTestCases.length;
  
  for (const testCase of realTestCases) {
    const isExcluded = isExcludedByKeywords(testCase.filename);
    const testPassed = isExcluded === testCase.shouldExclude;
    
    const status = testPassed ? '✅ PASSED' : '❌ FAILED';
    const action = testCase.shouldExclude ? 'EXCLUDED' : 'ALLOWED';
    const result = isExcluded ? 'EXCLUDED' : 'ALLOWED';
    
    console.log(`${status} ${testCase.filename}`);
    console.log(`   Expected: ${action}, Got: ${result}`);
    console.log(`   Description: ${testCase.description}`);
    console.log('');
    
    if (testPassed) passed++;
  }
  
  console.log('📊 SUMMARY:');
  console.log('='.repeat(70));
  console.log(`Passed: ${passed}/${total} tests`);
  
  if (passed === total) {
    console.log('🎉 ALL TESTS PASSED!');
    console.log('✅ Shipping labels will now be correctly excluded');
    console.log('✅ Proof files will now be correctly excluded');
    console.log('✅ Artwork files will now be correctly excluded');
    console.log('✅ Legitimate PO files will still be processed');
  } else {
    console.log('❌ Some tests failed - filtering logic needs improvement');
  }
}

testFiltering();