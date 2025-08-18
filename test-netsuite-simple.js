import { netsuiteService } from './server/services/netsuite.js';

console.log('🔧 Testing NetSuite connection...');

netsuiteService.testConnection()
  .then(result => {
    console.log('📊 Test Result:', JSON.stringify(result, null, 2));
    if (result.success) {
      console.log('✅ NetSuite connection successful!');
    } else {
      console.log('❌ NetSuite connection failed:', result.error);
    }
  })
  .catch(error => {
    console.error('💥 Test failed with error:', error.message);
    console.error('Full error:', error);
  });