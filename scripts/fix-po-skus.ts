import { db } from '../server/db';
import { purchaseOrders } from '@shared/schema';
import { eq } from 'drizzle-orm';

async function fixPOSkus(poId: string) {
  console.log(`\n🔧 FIXING SKUs FOR PO: ${poId}\n`);
  
  try {
    // Get the PO
    const po = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).limit(1);
    
    if (!po || po.length === 0) {
      console.error('❌ PO not found');
      return;
    }
    
    const purchaseOrder = po[0];
    console.log(`📄 PO Number: ${purchaseOrder.poNumber}`);
    console.log(`📊 Current Status: ${purchaseOrder.status}`);
    
    // Parse line items
    const lineItems = purchaseOrder.lineItems as any[];
    if (!lineItems || lineItems.length === 0) {
      console.log('❌ No line items found');
      return;
    }
    
    console.log(`\n📦 Current Line Items:`);
    lineItems.forEach((item, index) => {
      console.log(`  ${index + 1}. SKU: "${item.sku}" → finalSKU: "${item.finalSKU}" | ${item.description}`);
    });
    
    // Fix the SKUs based on the specific issue
    const fixedItems = lineItems.map((item, index) => {
      const updatedItem = { ...item };
      
      // First item: Lanyard with wrong finalSKU "SETUP"
      if (index === 0 && item.description?.toLowerCase().includes('lanyard')) {
        // Extract the actual SKU from the sku field
        const skuParts = (item.sku || '').split(',');
        if (skuParts.length > 0) {
          const primarySku = skuParts[0].trim();
          updatedItem.finalSKU = primarySku || 'OE-MISC-ITEM';
          console.log(`  ✅ Fixed item ${index + 1}: "${item.finalSKU}" → "${updatedItem.finalSKU}"`);
        }
      }
      
      // Second item: Setup charge with SKU "SETUP" but wrong finalSKU "OE-MISC-ITEM"
      if (item.sku === 'SETUP' && item.description?.toLowerCase().includes('setup')) {
        updatedItem.finalSKU = 'SETUP';
        console.log(`  ✅ Fixed item ${index + 1}: "${item.finalSKU}" → "${updatedItem.finalSKU}"`);
      }
      
      return updatedItem;
    });
    
    // Update the PO
    await db.update(purchaseOrders)
      .set({ 
        lineItems: fixedItems as any
      })
      .where(eq(purchaseOrders.id, poId));
    
    console.log(`\n✅ PO UPDATED SUCCESSFULLY`);
    
    console.log(`\n📦 Updated Line Items:`);
    fixedItems.forEach((item, index) => {
      console.log(`  ${index + 1}. SKU: "${item.sku}" → finalSKU: "${item.finalSKU}" | ${item.description}`);
    });
    
  } catch (error) {
    console.error('❌ Error fixing PO:', error);
  }
}

// Run the fix
const poId = process.argv[2] || '6544b9c9-977f-4691-a76c-ba8ebc1ba390';
fixPOSkus(poId).then(() => process.exit(0));