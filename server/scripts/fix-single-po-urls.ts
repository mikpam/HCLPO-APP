import { db } from '../db';
import { purchaseOrders } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { generateNSPayload } from '../services/ns-payload-generator';

async function fixSinglePO(poNumber: string) {
  console.log(`🔧 Regenerating NS payload for PO ${poNumber}...`);
  
  try {
    // Get the PO
    const [po] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.poNumber, poNumber));
    
    if (!po) {
      console.error(`❌ PO ${poNumber} not found`);
      process.exit(1);
    }
    
    console.log(`Found PO ${poNumber} with status: ${po.status}`);
    
    // Check current URLs
    const currentPayload = po.nsPayload as any;
    if (currentPayload) {
      const orderData = currentPayload.purchaseOrder || currentPayload;
      console.log('Current URLs:');
      console.log(`  Source: ${orderData.sourceDocumentUrl || 'none'}`);
      console.log(`  EML: ${orderData.emlUrl || 'none'}`);
    }
    
    // Generate new NS payload with presigned URLs
    const newNsPayload = await generateNSPayload(po);
    
    // Update the PO
    await db
      .update(purchaseOrders)
      .set({ 
        nsPayload: newNsPayload,
        updatedAt: new Date()
      })
      .where(eq(purchaseOrders.id, po.id));
    
    // Verify the new URLs
    const newOrderData = newNsPayload.purchaseOrder || newNsPayload;
    console.log('✅ New URLs generated:');
    console.log(`  Source: ${newOrderData.sourceDocumentUrl?.substring(0, 60)}...`);
    console.log(`  EML: ${newOrderData.emlUrl?.substring(0, 60)}...`);
    
    // Test fetching through API
    const response = await fetch(`http://localhost:5000/api/purchase-orders/${po.id}/netsuite-payload`);
    const apiPayload = await response.json();
    
    console.log('\n📋 API Payload check:');
    console.log(`  Attachment URLs: ${apiPayload.attachmentUrls?.length || 0} URLs`);
    if (apiPayload.attachmentUrls?.length > 0) {
      apiPayload.attachmentUrls.forEach((url: string, i: number) => {
        console.log(`    ${i + 1}. ${url.substring(0, 60)}...`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

// Get PO number from command line
const poNumber = process.argv[2] || '80066';
fixSinglePO(poNumber);