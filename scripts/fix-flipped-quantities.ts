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
    
    // Fix the flipped finalSKUs
    const fixedItems = lineItems.map((item) => {
      const updatedItem = { ...item };
      
      // Product items with finalSKU "SETUP" should use their actual SKU
      if (item.finalSKU === 'SETUP' && item.sku !== 'SETUP') {
        // Build proper finalSKU with color code if present
        if (item.itemColor) {
          const colorMap: Record<string, string> = {
            'Clear': 'CL',
            'Red': '02',
            'Black': '06',
            'Blue': '03',
            'White': '01'
          };
          const colorCode = colorMap[item.itemColor] || item.itemColor.substring(0, 2).toUpperCase();
          updatedItem.finalSKU = `${item.sku}-${colorCode}`;
        } else {
          updatedItem.finalSKU = item.sku;
        }
        console.log(`  ✅ Fixed ${item.sku}: finalSKU "${item.finalSKU}" → "${updatedItem.finalSKU}"`);
      }
      
      // SETUP charges should have finalSKU "SETUP"
      if (item.sku === 'SETUP' && item.finalSKU !== 'SETUP' && item.finalSKU !== 'EPROOF-KC') {
        updatedItem.finalSKU = 'SETUP';
        console.log(`  ✅ Fixed SETUP: finalSKU "${item.finalSKU}" → "${updatedItem.finalSKU}"`);
      }
      
      // OE-MISC-CHARGE items - only convert if it's a recognizable charge type
      // Otherwise keep OE-MISC-CHARGE as it's a valid finalSKU for unsolvable charges
      if (item.sku === 'OE-MISC-CHARGE' && item.finalSKU !== 'OE-MISC-CHARGE') {
        const desc = (item.description || '').toLowerCase();
        // Only convert to specific charge codes if clearly identifiable
        if (desc.includes('setup') || desc.includes('set up')) {
          updatedItem.finalSKU = 'SETUP';
          console.log(`  ✅ Converted OE-MISC-CHARGE: "${item.description}" → SETUP`);
        } else if (desc.includes('run charge')) {
          updatedItem.finalSKU = 'RUN-CHARGE';
          console.log(`  ✅ Converted OE-MISC-CHARGE: "${item.description}" → RUN-CHARGE`);
        } else if (desc.includes('ltm') || (desc.includes('less') && desc.includes('minimum'))) {
          updatedItem.finalSKU = 'LTM';
          console.log(`  ✅ Converted OE-MISC-CHARGE: "${item.description}" → LTM`);
        } else {
          // Keep as OE-MISC-CHARGE for shipping/unidentifiable charges
          updatedItem.finalSKU = 'OE-MISC-CHARGE';
          console.log(`  ℹ️ Keeping OE-MISC-CHARGE as placeholder for: "${item.description}"`);
        }
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