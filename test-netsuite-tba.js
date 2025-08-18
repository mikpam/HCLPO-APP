/**
 * NetSuite TBA NLAuth Authentication Test
 * Tests the simplified TBA authentication using NLAuth headers instead of OAuth 1.0
 * 
 * This replaces the complex OAuth 1.0 signature generation with simple header-based authentication
 */

import { NetSuiteService } from './server/services/netsuite.js';

async function testNetSuiteTBAConnection() {
  console.log('🚀 Testing NetSuite TBA NLAuth Authentication\n');
  
  try {
    const netsuite = new NetSuiteService();
    
    // Test basic connection
    console.log('📡 Testing basic connection...');
    const connectionResult = await netsuite.testConnection();
    
    if (connectionResult.success) {
      console.log('✅ NetSuite TBA connection successful!');
      console.log('📊 Connection Details:', {
        accountId: connectionResult.details?.accountId,
        restletUrl: connectionResult.details?.restletUrl,
        method: connectionResult.details?.method
      });
    } else {
      console.log('❌ NetSuite TBA connection failed:', connectionResult.error);
      console.log('💡 Possible issues:', connectionResult.details?.possibleIssues);
    }
    
    // Test with sample data if connection works
    if (connectionResult.success) {
      console.log('\n📦 Testing with sample order data...');
      
      const sampleOrderData = {
        customer: 'Test Customer',
        lineItems: [
          {
            item: 'TEST_ITEM',
            quantity: 1,
            description: 'Test Item for TBA Authentication'
          }
        ],
        memo: 'TBA Authentication Test Order'
      };
      
      const sampleUrls = [
        'https://example.com/test-email.eml',
        'https://example.com/test-attachment.pdf'
      ];
      
      const testResult = await netsuite.testCompleteOrderIntegration(sampleOrderData, sampleUrls);
      
      if (testResult.success) {
        console.log('✅ Complete integration test successful!');
        console.log('🎯 TBA Authentication is working correctly');
      } else {
        console.log('⚠️ Integration test failed (expected for test data):', testResult.error);
        console.log('✅ But TBA authentication itself is working!');
      }
    }
    
  } catch (error) {
    console.error('💥 Test failed with error:', error.message);
    console.log('\n🔧 Make sure you have set the following environment variables:');
    console.log('  - NETSUITE_ACCOUNT_ID');
    console.log('  - NETSUITE_EMAIL');
    console.log('  - NETSUITE_PASSWORD');
    console.log('  - NETSUITE_ROLE_ID');
    console.log('  - NETSUITE_APPLICATION_ID');
    console.log('  - NETSUITE_RESTLET_URL');
  }
}

// Show environment variables (masked for security)
function showEnvironmentStatus() {
  console.log('🔐 Environment Variables Status:');
  const requiredVars = [
    'NETSUITE_ACCOUNT_ID',
    'NETSUITE_EMAIL', 
    'NETSUITE_PASSWORD',
    'NETSUITE_ROLE_ID',
    'NETSUITE_APPLICATION_ID',
    'NETSUITE_RESTLET_URL'
  ];
  
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      // Mask sensitive values
      const maskedValue = varName.includes('PASSWORD') || varName.includes('EMAIL') 
        ? value.substring(0, 3) + '***' 
        : value.substring(0, 8) + '...';
      console.log(`  ✅ ${varName}: ${maskedValue}`);
    } else {
      console.log(`  ❌ ${varName}: Not set`);
    }
  });
  console.log('');
}

// Run the test
showEnvironmentStatus();
testNetSuiteTBAConnection();