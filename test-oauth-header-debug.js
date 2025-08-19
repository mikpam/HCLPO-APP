// Test to show exact OAuth header format
import crypto from 'crypto';

const consumerKey = process.env.NETSUITE_CONSUMER_KEY || '';
const consumerSecret = process.env.NETSUITE_CONSUMER_SECRET || '';
const accessToken = process.env.NETSUITE_ACCESS_TOKEN || '';
const accessTokenSecret = process.env.NETSUITE_ACCESS_TOKEN_SECRET || '';
const accountId = '4423013_SB1';
const url = 'https://4423013-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=2096&deploy=1';

function generateOAuthHeader(method) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(32).toString('hex');
  
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0'
  };

  // Create parameter string for signature
  const paramString = Object.keys(oauthParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(oauthParams[key])}`)
    .join('&');

  // Create signature base string
  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString)
  ].join('&');

  // Create signing key
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(accessTokenSecret)}`;

  // Generate signature
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(signatureBaseString)
    .digest('base64');

  // Add signature to parameters
  oauthParams.oauth_signature = signature;

  // Create authorization header (NEW FORMAT - matching fixed code)
  const headerParams = [
    `realm="${accountId}"`,
    ...Object.keys(oauthParams)
      .sort()
      .map(key => `${key}="${encodeURIComponent(oauthParams[key])}"`)
  ];
  
  const authHeader = `OAuth ${headerParams.join(', ')}`;

  console.log('🔐 NEW OAuth Header Format:');
  console.log(authHeader);
  console.log('\n📋 Header breakdown:');
  headerParams.forEach((param, i) => {
    console.log(`  ${i + 1}. ${param}`);
  });

  return authHeader;
}

console.log('=== Testing NEW OAuth Header Format ===');
const header = generateOAuthHeader('GET');

console.log('\n🧪 Testing with curl:');
console.log(`curl -v -H "Authorization: ${header}" -H "Content-Type: application/json" "${url}"`);