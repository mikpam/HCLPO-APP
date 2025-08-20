/**
 * Fix Missing Extraction Data Script
 * 
 * This script repairs purchase orders that were processed but have missing extraction_data.
 * Specifically designed to fix PO PIM25082043 and similar issues where Gemini extraction
 * worked but the data wasn't stored in the database properly.
 */

import { db } from '../server/db.js';
import { purchaseOrders } from '../shared/schema.js';
import { eq, isNull, or } from 'drizzle-orm';

// Sample extraction data based on the attached file for PO PIM25082043
const SAMPLE_EXTRACTION_DATA = {
  "engine": "gemini",
  "lineItems": [
    {
      "sku": "S910",
      "finalSKU": "S910-07",
      "quantity": 35,
      "itemColor": "Gray",
      "unitPrice": 6,
      "totalPrice": 210,
      "description": "The Hippo Mug & Straw Lid 40 oz.",
      "imprintColor": "White"
    },
    {
      "sku": "S910",
      "finalSKU": "S910-06",
      "quantity": 35,
      "itemColor": "Black",
      "unitPrice": 6,
      "totalPrice": 210,
      "description": "The Hippo Mug & Straw Lid 40 oz.",
      "imprintColor": "White"
    },
    {
      "sku": "S910",
      "finalSKU": "S910-00",
      "quantity": 30,
      "itemColor": "White",
      "unitPrice": 6,
      "totalPrice": 180,
      "description": "The Hippo Mug & Straw Lid 40 oz.",
      "imprintColor": "Black"
    },
    {
      "sku": "SETUP",
      "finalSKU": "SETUP",
      "quantity": 0,
      "itemColor": "",
      "unitPrice": 0,
      "totalPrice": 0,
      "description": "Setup Charge",
      "imprintColor": "White Imprint on Gray & Black Tumblers, Black Imprint on White Tumblers"
    }
  ],
  "subtotals": {
    "grandTotal": 600,
    "merchandiseSubtotal": 600,
    "additionalChargesSubtotal": 0
  },
  "purchaseOrder": {
    "shipTo": {
      "city": "Longmont",
      "name": "Heather Dudok",
      "state": "Colorado",
      "company": "Roof Source",
      "country": "United States",
      "zipCode": "80504",
      "address1": "1530 Vista View Drive",
      "address2": ""
    },
    "vendor": {
      "city": "",
      "name": "High Caliber Line",
      "email": "",
      "phone": "",
      "state": "",
      "country": "",
      "zipCode": "",
      "address1": "",
      "address2": ""
    },
    "contact": {
      "name": "Whitney Griffin",
      "email": "wgriffin@proimprint.com",
      "phone": "7436665643 Ext: 137",
      "jobTitle": ""
    },
    "customer": {
      "city": "Greensboro",
      "email": "wgriffin@proimprint.com",
      "phone": "7436665643",
      "state": "North Carolina",
      "company": "Prolmprint",
      "country": "United States",
      "zipCode": "27401",
      "address1": "1301 Carolina St, Suite 125",
      "address2": "",
      "lastName": "",
      "firstName": "",
      "customerNumber": "C94300"
    },
    "asiNumber": "181147",
    "orderDate": "08/20/2025",
    "ppaiNumber": "",
    "inHandsDate": "09/01/2025",
    "shippingMethod": "FEDEX GROUND",
    "salesPersonName": "Whitney Griffin",
    "shippingCarrier": "FEDEX",
    "requiredShipDate": "08/27/2025",
    "salesPersonEmail": "wgriffin@proimprint.com",
    "purchaseOrderNumber": "PIM25082043"
  },
  "additionalNotes": [],
  "specialInstructions": "Note: Pricing Per Dan Oas Please waive proof approval except Apparels Please ship this order on 08/27. This Order has a firm in hand date on 09/01. Authorized by: Blesson George."
};

async function fixMissingExtractionData() {
  console.log('🔧 FIXING MISSING EXTRACTION DATA');
  console.log('==================================');
  console.log('');

  try {
    // Step 1: Find POs with missing extraction data
    console.log('🔍 Step 1: Finding POs with missing extraction data...');
    
    const posWithMissingData = await db
      .select()
      .from(purchaseOrders)
      .where(
        or(
          isNull(purchaseOrders.extractedData),
          eq(purchaseOrders.extractedData, '{}')
        )
      );
    
    console.log(`   Found ${posWithMissingData.length} POs with missing extraction data`);
    
    // Step 2: Focus on PIM25082043 specifically
    const pimPO = posWithMissingData.find(po => 
      po.subject?.includes('PIM25082043') || 
      po.poNumber === 'PIM25082043'
    );
    
    if (pimPO) {
      console.log('');
      console.log('🎯 Step 2: Fixing PO PIM25082043...');
      console.log(`   ID: ${pimPO.id}`);
      console.log(`   Subject: ${pimPO.subject}`);
      console.log(`   Current Status: ${pimPO.status}`);
      
      // Update with the sample extraction data
      const [updatedPO] = await db
        .update(purchaseOrders)
        .set({
          extractedData: SAMPLE_EXTRACTION_DATA,
          lineItems: SAMPLE_EXTRACTION_DATA.lineItems,
          poNumber: 'PIM25082043', // Ensure PO number is set
          contact: SAMPLE_EXTRACTION_DATA.purchaseOrder.contact.name,
          customerName: SAMPLE_EXTRACTION_DATA.purchaseOrder.customer.company,
          updatedAt: new Date()
        })
        .where(eq(purchaseOrders.id, pimPO.id))
        .returning();
      
      console.log('   ✅ Successfully updated PO PIM25082043 with extraction data');
      console.log(`   └─ Contact: ${SAMPLE_EXTRACTION_DATA.purchaseOrder.contact.name}`);
      console.log(`   └─ Email: ${SAMPLE_EXTRACTION_DATA.purchaseOrder.contact.email}`);
      console.log(`   └─ Company: ${SAMPLE_EXTRACTION_DATA.purchaseOrder.customer.company}`);
      console.log(`   └─ Line Items: ${SAMPLE_EXTRACTION_DATA.lineItems.length}`);
      
      return updatedPO;
    } else {
      console.log('❌ PO PIM25082043 not found in database');
      return null;
    }
    
  } catch (error) {
    console.error('❌ Error fixing extraction data:', error);
    throw error;
  }
}

// Run the fix if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixMissingExtractionData()
    .then((result) => {
      if (result) {
        console.log('');
        console.log('✅ Fix completed successfully');
        process.exit(0);
      } else {
        console.log('');
        console.log('❌ Fix failed - PO not found');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('💥 Fix failed with error:', error);
      process.exit(1);
    });
}

export { fixMissingExtractionData };