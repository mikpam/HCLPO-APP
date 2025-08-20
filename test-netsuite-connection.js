import crypto from 'crypto';

// Simple NetSuite connection test
async function testNetSuiteConnection() {
  console.log('🔧 Testing NetSuite Connection...');
  
  const accountId = process.env.NETSUITE_ACCOUNT_ID;
  const consumerKey = process.env.NETSUITE_CONSUMER_KEY;
  const consumerSecret = process.env.NETSUITE_CONSUMER_SECRET;
  const tokenId = process.env.NETSUITE_TOKEN_ID;
  const tokenSecret = process.env.NETSUITE_TOKEN_SECRET;
  const restletUrl = process.env.NETSUITE_RESTLET_URL;

  console.log('📋 Checking credentials:');
  console.log('  Account ID:', accountId ? '✅ Present' : '❌ Missing');
  console.log('  Consumer Key:', consumerKey ? '✅ Present' : '❌ Missing');
  console.log('  Consumer Secret:', consumerSecret ? '✅ Present' : '❌ Missing');
  console.log('  Token ID:', tokenId ? '✅ Present' : '❌ Missing');
  console.log('  Token Secret:', tokenSecret ? '✅ Present' : '❌ Missing');
  console.log('  RESTlet URL:', restletUrl ? '✅ Present' : '❌ Missing');

  if (!accountId || !consumerKey || !consumerSecret || !tokenId || !tokenSecret || !restletUrl) {
    console.log('❌ Missing required credentials');
    return;
  }

  try {
    // Generate OAuth signature for test request
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = Math.random().toString(36).substring(2, 15);

    const parameters = {
      oauth_consumer_key: consumerKey,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: tokenId,
      oauth_version: '1.0'
    };

    // Create base string for signature
    const method = 'POST';
    const paramString = Object.entries(parameters)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .sort()
      .join('&');
    
    const baseString = `${method}&${encodeURIComponent(restletUrl)}&${encodeURIComponent(paramString)}`;
    
    // Generate signature
    const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
    const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    
    parameters.oauth_signature = signature;

    // Create Authorization header
    const authHeader = 'OAuth ' + Object.entries(parameters)
      .map(([key, value]) => `${encodeURIComponent(key)}="${encodeURIComponent(value)}"`)
      .join(', ');

    // Test request to NetSuite
    console.log('🌐 Making test request to NetSuite...');
    console.log('  URL:', restletUrl);
    
    const testPayload = {
      operation: 'test',
      data: {
        message: 'Connection test from HCL PO App'
      }
    };

    const response = await fetch(restletUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });

    console.log('📊 Response status:', response.status);
    console.log('📊 Response headers:', Object.fromEntries(response.headers));

    const responseText = await response.text();
    console.log('📊 Response body:', responseText);

    if (response.ok) {
      console.log('✅ NetSuite connection successful!');
      try {
        const responseData = JSON.parse(responseText);
        console.log('📋 Parsed response:', JSON.stringify(responseData, null, 2));
      } catch (e) {
        console.log('⚠️  Response is not JSON format');
      }
    } else {
      console.log('❌ NetSuite connection failed');
      console.log('   Status:', response.status, response.statusText);
    }

  } catch (error) {
    console.error('❌ Error testing NetSuite connection:', error);
    console.error('   Error details:', error.message);
  }
}

// Run the test
testNetSuiteConnection().then(() => {
  console.log('🏁 NetSuite connection test completed');
}).catch(error => {
  console.error('💥 Test failed:', error);
});