// OAuth Signature Debug Tool
// This helps compare our OAuth implementation with what works in Postman

import crypto from 'crypto';

// NetSuite OAuth credentials (from environment)
const CONSUMER_KEY = process.env.NETSUITE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.NETSUITE_CONSUMER_SECRET;  
const TOKEN_ID = process.env.NETSUITE_TOKEN_ID;
const TOKEN_SECRET = process.env.NETSUITE_TOKEN_SECRET;
const RESTLET_URL = process.env.NETSUITE_RESTLET_URL;

function generateOAuthSignature(method, url, timestamp, nonce) {
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
  
  return {
    baseUrl,
    allParameters,
    sortedParams,
    baseString,
    signingKey: signingKey.length, // Don't log the actual key
    signature,
    oauthParameters,
    authHeader: 'OAuth ' + Object.entries({
      ...oauthParameters,
      oauth_signature: signature
    }).map(([key, value]) => `${key}="${encodeURIComponent(value)}"`).join(', ')
  };
}

console.log('🔧 OAUTH SIGNATURE DEBUG TOOL');
console.log('==============================\n');

// Test with fixed timestamp and nonce for reproducibility
const testTimestamp = '1755550000';
const testNonce = 'testNonce123456';

console.log('📋 USING FIXED VALUES FOR REPRODUCIBILITY:');
console.log(`Timestamp: ${testTimestamp}`);
console.log(`Nonce: ${testNonce}`);
console.log(`URL: ${RESTLET_URL}\n`);

// Test GET request
console.log('🔍 TESTING GET REQUEST:');
console.log('=======================');
const getResult = generateOAuthSignature('GET', RESTLET_URL, testTimestamp, testNonce);

console.log('Base URL:', getResult.baseUrl);
console.log('Parameters:', JSON.stringify(getResult.allParameters, null, 2));
console.log('Sorted Params:', getResult.sortedParams);
console.log('Base String:', getResult.baseString);
console.log('Signing Key Length:', getResult.signingKey);
console.log('Signature:', getResult.signature);
console.log('Auth Header:', getResult.authHeader);

console.log('\n🔍 TESTING POST REQUEST:');
console.log('========================');
const postResult = generateOAuthSignature('POST', RESTLET_URL, testTimestamp, testNonce);

console.log('Base URL:', postResult.baseUrl);
console.log('Parameters:', JSON.stringify(postResult.allParameters, null, 2));
console.log('Sorted Params:', postResult.sortedParams);
console.log('Base String:', postResult.baseString);
console.log('Signing Key Length:', postResult.signingKey);
console.log('Signature:', postResult.signature);
console.log('Auth Header:', postResult.authHeader);

console.log('\n💡 DEBUGGING CHECKLIST:');
console.log('=======================');
console.log('✓ Check if credentials match exactly in environment variables');
console.log('✓ Verify RESTlet URL is correct');
console.log('✓ Confirm timestamp is not too old/new (within 5 minutes)');
console.log('✓ Check if base string construction matches OAuth 1.0 spec');
console.log('✓ Verify URL encoding is consistent');
console.log('✓ Test with same timestamp/nonce that worked in Postman');

console.log('\n🎯 POSTMAN COMPARISON:');
console.log('=====================');
console.log('1. Copy these exact values to Postman OAuth 1.0 settings:');
console.log(`   - Timestamp: ${testTimestamp}`);
console.log(`   - Nonce: ${testNonce}`);
console.log('2. Check if Postman generates the same signature');
console.log('3. If signatures match but still get 401, the issue is elsewhere');
console.log('4. If signatures differ, there is an encoding/construction issue');

console.log('\n🔧 NEXT STEPS:');
console.log('==============');
console.log('1. Test this exact signature in Postman');
console.log('2. Compare with working Postman request');
console.log('3. Check NetSuite RESTlet script configuration');
console.log('4. Verify deployment is active and accessible');