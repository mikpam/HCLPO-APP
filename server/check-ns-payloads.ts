import { db } from './db';
import { purchaseOrders } from '../shared/schema';
import { isNotNull, desc, eq } from 'drizzle-orm';

async function checkNSPayloads() {
  console.log('Checking for NS Payloads...\n');
  
  // Check for records with NS payload
  const recordsWithNSPayload = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      customerValidated: purchaseOrders.customerValidated,
      contactValidated: purchaseOrders.contactValidated,
      lineItemsValidated: purchaseOrders.lineItemsValidated,
      nsPayload: purchaseOrders.nsPayload
    })
    .from(purchaseOrders)
    .where(isNotNull(purchaseOrders.nsPayload))
    .limit(5);

  console.log(`Records with NS Payload: ${recordsWithNSPayload.length}`);
  
  if (recordsWithNSPayload.length > 0) {
    console.log('\nSample records with NS Payload:');
    recordsWithNSPayload.forEach(r => {
      console.log(`  PO #${r.poNumber} - Status: ${r.status}`);
      console.log(`    Validated: Customer=${r.customerValidated}, Contact=${r.contactValidated}, Items=${r.lineItemsValidated}`);
      if (r.nsPayload) {
        const payload = r.nsPayload as any;
        console.log(`    NS Payload: ${JSON.stringify({
          customer: payload.customer?.entityId || 'N/A',
          contact: payload.contact?.entityId || 'N/A',
          itemCount: payload.items?.length || 0
        })}`);
      }
    });
  } else {
    console.log('No records found with NS payload yet');
  }

  // Also check for ready_for_netsuite status
  const readyRecords = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      nsPayload: purchaseOrders.nsPayload
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.status, 'ready_for_netsuite'))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(10);

  console.log(`\nReady for NetSuite records: ${readyRecords.length}`);
  if (readyRecords.length > 0) {
    console.log('Status breakdown:');
    readyRecords.forEach(r => {
      const hasPayload = !!r.nsPayload;
      console.log(`  PO #${r.poNumber} - NS Payload: ${hasPayload ? '✓ Present' : '✗ Missing'}`);
    });
  }
  
  process.exit(0);
}

checkNSPayloads().catch(console.error);