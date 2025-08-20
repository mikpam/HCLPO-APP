/**
 * NetSuite 2FA Authentication Test
 * Quick test script for NetSuite connection with Two-Factor Authentication
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function testWith2FA() {
  console.log('🔐 NetSuite 2FA Authentication Test\n');
  
  rl.question('Please enter your 2FA code from your authenticator app: ', async (otp) => {
    if (!otp || otp.trim().length !== 6) {
      console.log('❌ Invalid OTP. Please enter a 6-digit code.');
      rl.close();
      return;
    }
    
    try {
      console.log('\n🚀 Testing NetSuite connection with 2FA...');
      
      const response = await fetch('http://localhost:5000/api/netsuite/test-connection-2fa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ otp: otp.trim() })
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('✅ NetSuite 2FA connection successful!');
        console.log('📊 Connection Details:', {
          accountId: result.details?.accountId,
          method: result.details?.method,
          restletUrl: result.details?.restletUrl
        });
        console.log('\n🎯 Your NetSuite integration is now working with TBA NLAuth authentication!');
      } else {
        console.log('❌ NetSuite 2FA connection failed:', result.error || result.message);
      }
      
    } catch (error) {
      console.error('💥 Test failed with error:', error.message);
    } finally {
      rl.close();
    }
  });
}

// Check if server is running
fetch('http://localhost:5000/api/netsuite/test-connection')
  .then(() => testWith2FA())
  .catch(() => {
    console.log('❌ Server not running. Please start with: npm run dev');
    rl.close();
  });