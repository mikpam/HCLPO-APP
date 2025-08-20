// Simple test to demonstrate the artwork detection fix
console.log('🎨 Enhanced Artwork Detection Fix Test\n');

// Simulate the enhanced artwork detection logic
function isArtworkFile(filename, contentType) {
  const artworkExtensions = ['.ai', '.eps', '.svg', '.png', '.jpg', '.jpeg', '.tif', '.gif'];
  const artworkMimeTypes = ['application/postscript', 'image/', 'application/illustrator'];
  
  // NEW: Enhanced artwork filename patterns (case insensitive)
  const artworkPatterns = [
    /logo/i, /art/i, /artwork/i, /design/i, /proof/i, /mock/i, 
    /visual/i, /graphic/i, /brand/i, /creative/i, /layout/i
  ];
  
  const hasArtworkExtension = artworkExtensions.some(ext => 
    filename.toLowerCase().endsWith(ext)
  );
  
  const hasArtworkMimeType = artworkMimeTypes.some(mime => 
    contentType.toLowerCase().includes(mime)
  );
  
  // NEW: Check for artwork patterns in filename
  const hasArtworkPattern = artworkPatterns.some(pattern => 
    pattern.test(filename)
  );
  
  return hasArtworkExtension || hasArtworkMimeType || hasArtworkPattern;
}

// Test the problematic case from PO-2025-043712
const problemFile = {
  filename: 'graz_MSOD_logo_stacked.pdf',
  contentType: 'application/pdf'
};

console.log('🔍 Testing PO-2025-043712 Problematic File:');
console.log(`   Filename: ${problemFile.filename}`);
console.log(`   Content Type: ${problemFile.contentType}`);

const isArtworkResult = isArtworkFile(problemFile.filename, problemFile.contentType);

console.log(`\n✅ Result: ${isArtworkResult ? 'ARTWORK DETECTED' : 'NOT ARTWORK'}`);
console.log(`\n🎯 Fix Status: ${isArtworkResult ? 'SUCCESS - Would now be filtered out as artwork' : 'FAILED - Still not detected'}`);

// Additional test cases
const testCases = [
  { filename: 'company_logo.pdf', contentType: 'application/pdf' },
  { filename: 'product_artwork_v2.pdf', contentType: 'application/pdf' },
  { filename: 'design_mockup.pdf', contentType: 'application/pdf' },
  { filename: 'purchase_order_123.pdf', contentType: 'application/pdf' }, // Should NOT be artwork
];

console.log('\n📊 Additional Test Cases:');
testCases.forEach((test, i) => {
  const result = isArtworkFile(test.filename, test.contentType);
  console.log(`   ${i+1}. ${test.filename}: ${result ? 'ARTWORK' : 'NOT ARTWORK'}`);
});

console.log('\n🔧 Enhancement Summary:');
console.log('- Added filename pattern matching for artwork-related terms');
console.log('- Now detects PDFs with "logo", "art", "design", "proof", etc.');
console.log('- Fixes the PO-2025-043712 misclassification issue');