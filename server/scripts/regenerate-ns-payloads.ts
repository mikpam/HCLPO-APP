import { db } from '../db';
import { purchaseOrders } from '@shared/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { generateNSPayload } from '../services/ns-payload-generator';

async function regenerateNSPayloads() {
  console.log('🔧 Regenerating NS payloads with presigned URLs...');
  
  try {
    // Get all POs that are ready for NetSuite or already sent
    const posToUpdate = await db
      .select()
      .from(purchaseOrders)
      .where(
        or(
          eq(purchaseOrders.status, 'ready_for_netsuite'),
          eq(purchaseOrders.status, 'sent_to_netsuite')
        )
      );
    
    console.log(`Found ${posToUpdate.length} POs to regenerate NS payloads for`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const po of posToUpdate) {
      try {
        // Check if NS payload has internal URLs
        const nsPayload = po.nsPayload as any;
        if (!nsPayload) {
          console.log(`⚠️  PO ${po.poNumber} has no NS payload, skipping`);
          continue;
        }
        
        const purchaseOrderData = nsPayload.purchaseOrder || nsPayload;
        const sourceUrl = purchaseOrderData.sourceDocumentUrl || '';
        const emlUrl = purchaseOrderData.emlUrl || '';
        
        // Skip if URLs are already presigned
        if (sourceUrl.startsWith('https://') && emlUrl.startsWith('https://')) {
          console.log(`✅ PO ${po.poNumber} already has presigned URLs`);
          successCount++;
          continue;
        }
        
        console.log(`🔄 Regenerating NS payload for PO ${po.poNumber}...`);
        console.log(`   Current source URL: ${sourceUrl || 'none'}`);
        console.log(`   Current eml URL: ${emlUrl || 'none'}`);
        
        // Generate new NS payload with presigned URLs
        const newNsPayload = await generateNSPayload(po);
        
        // Update the PO with the new NS payload
        await db
          .update(purchaseOrders)
          .set({ 
            nsPayload: newNsPayload,
            updatedAt: new Date()
          })
          .where(eq(purchaseOrders.id, po.id));
        
        // Verify the new URLs
        const newPurchaseOrderData = newNsPayload.purchaseOrder || newNsPayload;
        console.log(`   ✅ New source URL: ${newPurchaseOrderData.sourceDocumentUrl?.substring(0, 50)}...`);
        console.log(`   ✅ New eml URL: ${newPurchaseOrderData.emlUrl?.substring(0, 50)}...`);
        
        successCount++;
      } catch (error) {
        console.error(`❌ Error regenerating NS payload for PO ${po.poNumber}:`, error);
        errorCount++;
      }
    }
    
    console.log('\n📊 Regeneration complete:');
    console.log(`   ✅ Success: ${successCount} POs`);
    console.log(`   ❌ Errors: ${errorCount} POs`);
    
  } catch (error) {
    console.error('❌ Error regenerating NS payloads:', error);
  }
  
  process.exit(0);
}

regenerateNSPayloads();