// Test OAuth 1.0 signature generation to match Postman exactly
import crypto from 'crypto';

const consumerKey = process.env.NETSUITE_CONSUMER_KEY;
const consumerSecret = process.env.NETSUITE_CONSUMER_SECRET;
const accessToken = process.env.NETSUITE_TOKEN_ID;
const accessTokenSecret = process.env.NETSUITE_TOKEN_SECRET;
const accountId = process.env.NETSUITE_ACCOUNT_ID;
const restletUrl = process.env.NETSUITE_RESTLET_URL;

console.log('🔐 OAuth Debug Information:');
console.log('Consumer Key:', consumerKey?.substring(0, 10) + '...');
console.log('Consumer Secret:', consumerSecret?.substring(0, 10) + '...');
console.log('Access Token:', accessToken?.substring(0, 10) + '...');
console.log('Token Secret:', accessTokenSecret?.substring(0, 10) + '...');
console.log('Account ID:', accountId);
console.log('RESTlet URL:', restletUrl);

function generateOAuthHeader(method, url) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  
  // OAuth parameters (exactly like Postman)
  const params = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0'
  };

  // Create parameter string for signature
  const paramString = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  console.log('📋 Parameter String:', paramString);

  // Create signature base string
  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString)
  ].join('&');

  console.log('🔑 Signature Base String:', signatureBaseString);

  // Create signing key
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(accessTokenSecret)}`;
  
  console.log('🗝️ Signing Key:', signingKey.substring(0, 20) + '...');

  // Generate signature
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(signatureBaseString)
    .digest('base64');

  console.log('✍️ Generated Signature:', signature);

  // Add signature to parameters
  params.oauth_signature = signature;

  // Create authorization header (Postman style)
  const authHeader = 'OAuth realm="' + accountId + '",' +
    Object.keys(params)
      .sort()
      .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(params[key])}"`)
      .join(',');

  console.log('🎯 Final OAuth Header:', authHeader);
  
  return authHeader;
}

// Test both GET and POST
console.log('\n=== GET Request ===');
const getHeader = generateOAuthHeader('GET', restletUrl);

console.log('\n=== POST Request ===');
const postHeader = generateOAuthHeader('POST', restletUrl);

// Test with a simple fetch call
async function testDirectly() {
  try {
    console.log('\n🧪 Testing GET request directly...');
    const response = await fetch(restletUrl, {
      method: 'GET',
      headers: {
        'Authorization': getHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    const text = await response.text();
    console.log(`📊 Direct Response [${response.status}]:`, text);
    
  } catch (error) {
    console.error('❌ Direct test failed:', error.message);
  }
}

testDirectly();