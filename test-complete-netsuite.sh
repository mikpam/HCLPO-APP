#!/bin/bash

# Complete NetSuite Integration Test
# Usage: ./test-complete-netsuite.sh <2fa-code>

if [ -z "$1" ]; then
    echo "❌ Please provide your 2FA code"
    echo "Usage: ./test-complete-netsuite.sh 123456"
    exit 1
fi

OTP_CODE=$1

echo "🚀 Testing Complete NetSuite Integration"
echo "📱 Using 2FA code: $OTP_CODE"
echo ""

# Complete test payload with extracted JSON data + file URLs
curl -s -X POST http://localhost:5000/api/netsuite/test-object-storage \
  -H "Content-Type: application/json" \
  -d "{
    \"extractedData\": {
      \"engine\": \"gemini\",
      \"lineItems\": [
        {
          \"sku\": \"JT101\",
          \"finalSKU\": \"OE-MISC-ITEM\",
          \"quantity\": 340,
          \"itemColor\": \"White\",
          \"unitPrice\": 1.53,
          \"totalPrice\": 520.2,
          \"description\": \"The Amherst Journal By Trilogy\",
          \"isValidSKU\": true,
          \"productName\": \"Unidentified Items\"
        },
        {
          \"sku\": \"SETUP\",
          \"finalSKU\": \"SETUP\",
          \"quantity\": 1,
          \"unitPrice\": 48,
          \"totalPrice\": 48,
          \"description\": \"Setup Charge\",
          \"isValidSKU\": true,
          \"productName\": \"Setup Charge\"
        }
      ],
      \"purchaseOrder\": {
        \"customer\": {
          \"company\": \"MSP Design Group\",
          \"customerNumber\": \"C96422\",
          \"city\": \"Virginia Beach\",
          \"state\": \"Virginia\",
          \"zipCode\": \"23452\"
        },
        \"contact\": {
          \"name\": \"Pearl Jarque\",
          \"email\": \"pearl@mspdesigngroup.com\"
        },
        \"purchaseOrderNumber\": \"87546-1\",
        \"orderDate\": \"08/18/2025\",
        \"inHandsDate\": \"09/10/2025\"
      },
      \"subtotals\": {
        \"grandTotal\": 568.2,
        \"merchandiseSubtotal\": 520.2,
        \"additionalChargesSubtotal\": 48
      }
    },
    \"files\": {
      \"originalEmail\": \"https://your-app.replit.app/objects/emails/87546-1_email.eml\",
      \"attachments\": [
        {
          \"filename\": \"87546-1.pdf\",
          \"url\": \"https://your-app.replit.app/objects/attachments/87546-1.pdf\",
          \"type\": \"application/pdf\"
        }
      ]
    },
    \"metadata\": {
      \"poNumber\": \"87546-1\",
      \"customerNumber\": \"C96422\",
      \"grandTotal\": 568.2,
      \"lineItemCount\": 2,
      \"validationStatus\": {
        \"customer\": \"found\",
        \"contact\": \"validated\",
        \"lineItems\": \"validated\"
      }
    },
    \"otp\": \"$OTP_CODE\"
  }" | jq .

echo ""
echo "✅ Test completed!"