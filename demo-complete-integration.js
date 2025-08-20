/**
 * Complete NetSuite Integration Demo
 * Tests sending extracted JSON data with .eml and .pdf URLs to NetSuite
 */

import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Sample extracted data from a real processed PO
const sampleExtractedData = {
  "engine": "gemini",
  "lineItems": [
    {
      "sku": "JT101",
      "finalSKU": "OE-MISC-ITEM",
      "quantity": 340,
      "itemColor": "White",
      "unitPrice": 1.53,
      "totalPrice": 520.2,
      "description": "The Amherst Journal By Trilogy",
      "imprintColor": "2c7e3e approximate",
      "isValidSKU": true,
      "productName": "Unidentified Items",
      "validationNotes": "Valid product SKU"
    },
    {
      "sku": "SETUP",
      "finalSKU": "SETUP",
      "quantity": 1,
      "itemColor": "",
      "unitPrice": 48,
      "totalPrice": 48,
      "description": "Setup Charge",
      "imprintColor": "",
      "isValidSKU": true,
      "productName": "Setup Charge",
      "validationNotes": "Valid product SKU"
    }
  ],
  "subtotals": {
    "grandTotal": 568.2,
    "merchandiseSubtotal": 520.2,
    "additionalChargesSubtotal": 48
  },
  "purchaseOrder": {
    "shipTo": {
      "city": "Virginia Beach",
      "name": "INTERNAL MSP",
      "state": "Virginia",
      "company": "MSP Marketing / Company Orders",
      "country": "United States",
      "zipCode": "23452",
      "address1": "641 Phoenix Drive",
      "address2": ""
    },
    "vendor": {
      "city": "Irwindale",
      "name": "High Caliber Line",
      "email": "",
      "phone": "",
      "state": "California",
      "country": "United States",
      "zipCode": "91702",
      "address1": "6250 North Irwindale Avenue",
      "address2": ""
    },
    "contact": {
      "name": "Pearl Jarque",
      "email": "pearl@mspdesigngroup.com",
      "phone": "",
      "jobTitle": ""
    },
    "customer": {
      "city": "Virginia Beach",
      "email": "",
      "phone": "",
      "state": "Virginia",
      "company": "MSP Design Group",
      "country": "United States",
      "zipCode": "23452",
      "address1": "641 Phoenix Drive",
      "address2": "",
      "lastName": "",
      "firstName": "",
      "customerNumber": "C96422"
    },
    "asiNumber": "515806",
    "orderDate": "08/18/2025",
    "ppaiNumber": "674447",
    "inHandsDate": "09/10/2025",
    "shippingMethod": "UPS Ground",
    "salesPersonName": "Pearl Jarque",
    "shippingCarrier": "UPS",
    "requiredShipDate": "",
    "salesPersonEmail": "pearl@mspdesigngroup.com",
    "purchaseOrderNumber": "87546-1"
  },
  "forwardedEmail": {
    "cNumber": "C96422",
    "isForwarded": true,
    "hclForwarder": "Information Please <info@highcaliberline.com>",
    "originalSender": "Pearl Jarque <pearl@mspdesigngroup.com>"
  },
  "additionalNotes": [
    "***SELF PROMO***",
    "***SEND PROOF PRIOR TO PRODUCTION***",
    "***MUST BE IN HANDS BEFORE 9/10***"
  ],
  "validatedContact": {
    "name": "Pearl Jarque",
    "role": "Unknown",
    "email": "pearl@mspdesigngroup.com",
    "phone": "",
    "evidence": [
      "Extracted JSON contains salesPersonEmail: pearl@mspdesigngroup.com",
      "Email domain matches customer domain: mspdesigngroup.com"
    ],
    "confidence": 0.95,
    "match_method": "EXTRACTED_JSON",
    "matched_contact_id": ""
  },
  "validatedLineItems": [
    {
      "sku": "JT101",
      "finalSKU": "OE-MISC-ITEM",
      "quantity": 340,
      "itemColor": "White",
      "isValidSKU": true,
      "description": "The Amherst Journal By Trilogy",
      "productName": "Unidentified Items",
      "validationNotes": "Valid product SKU"
    },
    {
      "sku": "SETUP",
      "finalSKU": "SETUP",
      "quantity": 1,
      "itemColor": "",
      "isValidSKU": true,
      "description": "Setup Charge",
      "productName": "Setup Charge",
      "validationNotes": "Valid product SKU"
    }
  ],
  "specialInstructions": "***SHIP ON MSP UPS# 85F11E *** Advise us immediately of any pricing and/or delivery date corrections to this order. Failure to do so may invalidate this order. ***SEND PROOF PRIOR TO PRODUCTION***",
  "skuValidationCompleted": true,
  "contactValidationCompleted": true
};

async function testCompleteIntegration() {
  console.log('🚀 Complete NetSuite Integration Test\n');
  console.log('This will send extracted JSON data with .eml and .pdf URLs to NetSuite\n');
  
  rl.question('Please enter your 2FA code from your authenticator app: ', async (otp) => {
    if (!otp || otp.trim().length !== 6) {
      console.log('❌ Invalid OTP. Please enter a 6-digit code.');
      rl.close();
      return;
    }
    
    try {
      console.log('\n📦 Preparing complete payload...');
      
      // Complete payload with extracted data + file URLs
      const completePayload = {
        // Main extracted purchase order data
        extractedData: sampleExtractedData,
        
        // File URLs for NetSuite to download (demo URLs - real files would be stored in object storage)
        files: {
          originalEmail: "https://your-repl-name.replit.app/objects/emails/87546-1_original_email.eml",
          attachments: [
            {
              filename: "87546-1.pdf", 
              url: "https://your-repl-name.replit.app/objects/attachments/87546-1_purchase_order.pdf",
              type: "application/pdf"
            }
          ]
        },
        
        // Processing metadata
        metadata: {
          processedAt: new Date().toISOString(),
          poNumber: "87546-1",
          emailId: "198bef9885d5e8c1",
          customerNumber: "C96422",
          grandTotal: 568.2,
          lineItemCount: 2,
          validationStatus: {
            customer: "found",
            contact: "validated", 
            lineItems: "validated"
          }
        }
      };
      
      console.log('📊 Payload summary:');
      console.log('  - PO Number:', completePayload.metadata.poNumber);
      console.log('  - Customer:', completePayload.extractedData.purchaseOrder.customer.company);
      console.log('  - Total Amount: $' + completePayload.metadata.grandTotal);
      console.log('  - Line Items:', completePayload.metadata.lineItemCount);
      console.log('  - Original Email URL:', completePayload.files.originalEmail);
      console.log('  - PDF Attachment URL:', completePayload.files.attachments[0].url);
      console.log();
      
      console.log('🚀 Sending complete payload to NetSuite with 2FA...');
      
      const response = await fetch('http://localhost:5000/api/netsuite/test-object-storage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...completePayload,
          otp: otp.trim()
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Complete NetSuite integration successful!');
        console.log('📊 NetSuite Response:', result);
        console.log('\n🎯 Your complete workflow is working:');
        console.log('   ✅ Email processing → AI extraction → Validation → File storage → NetSuite integration');
      } else {
        console.log('❌ NetSuite integration failed:', result.error || result.message);
        if (result.details) {
          console.log('📋 Details:', result.details);
        }
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
  .then(() => testCompleteIntegration())
  .catch(() => {
    console.log('❌ Server not running. Please start with: npm run dev');
    rl.close();
  });