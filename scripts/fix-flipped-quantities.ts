import { db } from '../server/db';
import { purchaseOrders } from '@shared/schema';
import { eq } from 'drizzle-orm';

async function fixFlippedQuantities(poId: string) {
  console.log(`\n🔧 FIXING FLIPPED QUANTITIES FOR PO: ${poId}\n`);
  
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
    const extractedData = purchaseOrder.extractedData as any;
    
    if (!lineItems || lineItems.length === 0) {
      console.log('❌ No line items found');
      return;
    }
    
    console.log(`\n📦 Current Line Items (showing flipped state):`);
    lineItems.forEach((item, index) => {
      console.log(`  ${index + 1}. SKU: "${item.sku}" → finalSKU: "${item.finalSKU}" | Qty: ${item.quantity} | ${item.description}`);
    });
    
    // Fix the specific issue: T871 and SETUP are flipped
    const fixedItems = lineItems.map((item) => {
      const updatedItem = { ...item };
      
      // T871 item should have T871-CL as finalSKU, not SETUP
      if (item.sku === 'T871' && item.finalSKU === 'SETUP') {
        updatedItem.finalSKU = 'T871-CL';  // or just 'T871' depending on validation
        console.log(`  ✅ Fixed T871: finalSKU "${item.finalSKU}" → "${updatedItem.finalSKU}"`);
      }
      
      // SETUP item should have SETUP as finalSKU, not T871-CL
      if (item.sku === 'SETUP' && item.finalSKU === 'T871-CL') {
        updatedItem.finalSKU = 'SETUP';
        console.log(`  ✅ Fixed SETUP: finalSKU "${item.finalSKU}" → "${updatedItem.finalSKU}"`);
      }
      
      return updatedItem;
    });
    
    // Also fix in extractedData if present
    let fixedExtractedData = extractedData;
    if (extractedData?.lineItems) {
      fixedExtractedData = {
        ...extractedData,
        lineItems: extractedData.lineItems.map((item: any) => {
          const updatedItem = { ...item };
          
          // Same fixes as above
          if (item.sku === 'T871' && item.finalSKU === 'SETUP') {
            updatedItem.finalSKU = 'T871-CL';
          }
          if (item.sku === 'SETUP' && item.finalSKU === 'T871-CL') {
            updatedItem.finalSKU = 'SETUP';
          }
          
          return updatedItem;
        })
      };
    }
    
    // Update the PO
    await db.update(purchaseOrders)
      .set({ 
        lineItems: fixedItems as any,
        extractedData: fixedExtractedData as any
      })
      .where(eq(purchaseOrders.id, poId));
    
    console.log(`\n✅ PO UPDATED SUCCESSFULLY`);
    
    console.log(`\n📦 Fixed Line Items:`);
    fixedItems.forEach((item, index) => {
      console.log(`  ${index + 1}. SKU: "${item.sku}" → finalSKU: "${item.finalSKU}" | Qty: ${item.quantity} | ${item.description}`);
    });
    
  } catch (error) {
    console.error('❌ Error fixing PO:', error);
  }
}

// Run the fix
const poId = process.argv[2] || '31eca408-857e-4804-9e5f-1d247dfeda03';
fixFlippedQuantities(poId).then(() => process.exit(0));