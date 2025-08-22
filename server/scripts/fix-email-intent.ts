import { db } from '../db';
import { purchaseOrders } from '@shared/schema';
import { eq, and, isNull, or, sql } from 'drizzle-orm';

async function fixEmailIntent() {
  console.log('🔧 Fixing email intent for processed POs...');
  
  try {
    // Update POs with null emailIntent that are clearly purchase orders
    const result = await db
      .update(purchaseOrders)
      .set({ emailIntent: 'purchase_order' })
      .where(
        and(
          isNull(purchaseOrders.emailIntent),
          or(
            eq(purchaseOrders.status, 'ready_for_netsuite'),
            eq(purchaseOrders.status, 'sent_to_netsuite')
          ),
          sql`${purchaseOrders.extractedData} IS NOT NULL`
        )
      )
      .returning({ 
        id: purchaseOrders.id, 
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status 
      });
    
    console.log(`✅ Updated ${result.length} purchase orders with correct email intent`);
    
    if (result.length > 0) {
      console.log('Updated POs:');
      result.forEach(po => {
        console.log(`  - PO ${po.poNumber} (${po.id})`);
      });
    }
    
    // Verify the specific PO mentioned by user
    const specificPO = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        emailIntent: purchaseOrders.emailIntent,
        status: purchaseOrders.status
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, 'ca104bf2-283f-4bfe-9ace-47741701dde4'));
    
    if (specificPO.length > 0) {
      console.log('\n📋 PO 1806975 status:');
      console.log(`  - ID: ${specificPO[0].id}`);
      console.log(`  - PO Number: ${specificPO[0].poNumber}`);
      console.log(`  - Email Intent: ${specificPO[0].emailIntent || 'null'}`);
      console.log(`  - Status: ${specificPO[0].status}`);
    }
    
  } catch (error) {
    console.error('❌ Error fixing email intent:', error);
  }
  
  process.exit(0);
}

fixEmailIntent();