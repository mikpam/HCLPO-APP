// Test OAuth with Fixed Values to Match Postman
// This tests using the exact same timestamp and nonce that we can verify in Postman

import crypto from 'crypto';
import fetch from 'node-fetch';

// NetSuite OAuth credentials (from environment)
const CONSUMER_KEY = process.env.NETSUITE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.NETSUITE_CONSUMER_SECRET;  
const TOKEN_ID = process.env.NETSUITE_TOKEN_ID;
const TOKEN_SECRET = process.env.NETSUITE_TOKEN_SECRET;
const RESTLET_URL = process.env.NETSUITE_RESTLET_URL;

function generateOAuthHeader(method, url, timestamp, nonce) {
  const oauthParameters = {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: TOKEN_ID,
    oauth_version: '1.0'
  };

  // Parse URL to extract query parameters
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  
  // Combine OAuth parameters with URL query parameters
  const allParameters = { ...oauthParameters };
  
  // Add URL query parameters to signature parameters
  urlObj.searchParams.forEach((value, key) => {
    allParameters[key] = value;
  });

  // Create parameter string for signature (all parameters sorted)
  const sortedParams = Object.entries(allParameters)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join('&');
  
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(baseUrl)}&${encodeURIComponent(sortedParams)}`;
  
  // Generate HMAC-SHA1 signature
  const signingKey = `${encodeURIComponent(CONSUMER_SECRET)}&${encodeURIComponent(TOKEN_SECRET)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  
  // Create authorization header
  const authParams = {
    ...oauthParameters,
    oauth_signature: signature
  };

  const authHeader = 'OAuth ' + Object.entries(authParams)
    .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
    .join(', ');
  
  return {
    authHeader,
    signature,
    baseString,
    sortedParams,
    debugInfo: {
      method: method.toUpperCase(),
      baseUrl,
      allParameters,
      signingKeyLength: signingKey.length
    }
  };
}

async function testNetSuiteConnection() {
  console.log('🔧 TESTING NETSUITE WITH FIXED VALUES');
  console.log('=====================================\n');

  // Use the exact same timestamp and nonce from our debug output
  const fixedTimestamp = '1755550000';
  const fixedNonce = 'testNonce123456';
  
  console.log(`Using Fixed Values:`);
  console.log(`Timestamp: ${fixedTimestamp}`);
  console.log(`Nonce: ${fixedNonce}`);
  console.log(`URL: ${RESTLET_URL}\n`);

  try {
    // Test GET request
    console.log('🔍 TESTING GET WITH FIXED VALUES:');
    console.log('==================================');
    
    const getAuth = generateOAuthHeader('GET', RESTLET_URL, fixedTimestamp, fixedNonce);
    
    console.log('Expected signature:', 'bOv+wjndYqd0en7q3WY5ysAF/6g=');
    console.log('Generated signature:', getAuth.signature);
    console.log('Signatures match:', getAuth.signature === 'bOv+wjndYqd0en7q3WY5ysAF/6g=');
    
    const getResponse = await fetch(RESTLET_URL, {
      method: 'GET',
      headers: {
        'Authorization': getAuth.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    const getResponseText = await getResponse.text();
    console.log(`GET Response Status: ${getResponse.status}`);
    console.log(`GET Response Body: ${getResponseText}\n`);
    
    // Test POST request
    console.log('🔍 TESTING POST WITH FIXED VALUES:');
    console.log('===================================');
    
    const postAuth = generateOAuthHeader('POST', RESTLET_URL, fixedTimestamp, fixedNonce);
    
    console.log('Expected signature:', 'UMfcsacar488nwvgY8ZmHcvftBA=');
    console.log('Generated signature:', postAuth.signature);
    console.log('Signatures match:', postAuth.signature === 'UMfcsacar488nwvgY8ZmHcvftBA=');
    
    const testData = { test: 'data', timestamp: fixedTimestamp };
    
    const postResponse = await fetch(RESTLET_URL, {
      method: 'POST',
      headers: {
        'Authorization': postAuth.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(testData)
    });
    
    const postResponseText = await postResponse.text();
    console.log(`POST Response Status: ${postResponse.status}`);
    console.log(`POST Response Body: ${postResponseText}\n`);
    
    // Analyze results
    console.log('📊 ANALYSIS:');
    console.log('============');
    
    if (getAuth.signature === 'bOv+wjndYqd0en7q3WY5ysAF/6g=' && 
        postAuth.signature === 'UMfcsacar488nwvgY8ZmHcvftBA=') {
      console.log('✅ Our OAuth signature generation is mathematically CORRECT');
      console.log('✅ Signatures exactly match expected values from debug tool');
      
      if (getResponse.status === 401 || postResponse.status === 401) {
        console.log('⚠️  Still getting 401 with correct signatures');
        console.log('🔍 This suggests the issue is NOT in our OAuth implementation');
        console.log('🔍 Possible causes:');
        console.log('   - RESTlet script configuration');
        console.log('   - Deployment settings');
        console.log('   - Account/environment restrictions');
        console.log('   - Timestamp too old (our test uses old timestamp)');
      } else {
        console.log('🎉 SUCCESS! The connection works with fixed values');
      }
    } else {
      console.log('❌ Signature mismatch - there is a bug in our implementation');
    }
    
    console.log('\n🎯 NEXT STEPS:');
    console.log('==============');
    
    if (getAuth.signature === 'bOv+wjndYqd0en7q3WY5ysAF/6g=') {
      console.log('1. ✅ Our OAuth implementation is mathematically correct');
      console.log('2. 🔍 Test these EXACT values in Postman:');
      console.log(`   - Timestamp: ${fixedTimestamp}`);
      console.log(`   - Nonce: ${fixedNonce}`);
      console.log('3. 🔍 If Postman also gets 401 with these values, the timestamp is too old');
      console.log('4. 🔍 If Postman works with these values, check RESTlet configuration');
      console.log('5. 🔍 Try with a current timestamp in both systems');
    } else {
      console.log('1. ❌ Fix the signature generation bug first');
      console.log('2. 🔍 Debug the parameter encoding or sorting logic');
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the test
testNetSuiteConnection();