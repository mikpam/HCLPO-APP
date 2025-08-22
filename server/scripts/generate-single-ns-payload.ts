#!/usr/bin/env tsx

import { db } from "../db";
import { purchaseOrders } from "@shared/schema";
import { eq } from "drizzle-orm";
import { generateNSPayload } from "../services/ns-payload-generator";

async function generateSingleNSPayload(poId: string) {
  console.log(`🔍 Looking for PO with ID: ${poId}...`);
  
  try {
    // Find the specific PO
    const [po] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, poId));
    
    if (!po) {
      console.log(`❌ PO with ID ${poId} not found`);
      return;
    }
    
    console.log(`Found PO ${po.poNumber} (Status: ${po.status})`);
    
    if (po.nsPayload) {
      console.log(`✅ PO ${po.poNumber} already has an NS payload`);
      return;
    }
    
    console.log(`📦 Generating NS payload for PO ${po.poNumber}...`);
    
    // Generate the NS payload
    const nsPayload = await generateNSPayload(po);
    
    // Update the PO with the generated payload
    await db
      .update(purchaseOrders)
      .set({ 
        nsPayload: nsPayload,
        updatedAt: new Date()
      })
      .where(eq(purchaseOrders.id, po.id));
    
    console.log(`✅ NS payload generated successfully for PO ${po.poNumber}`);
    console.log(`\nNS Payload preview:`);
    console.log(JSON.stringify(nsPayload, null, 2).substring(0, 500) + '...');
    
  } catch (error) {
    console.error("Error generating NS payload:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Get PO ID from command line argument or use the specific one
const poId = process.argv[2] || 'f6b72b54-b956-4d76-bd31-811451c3ae90';

// Run the script
generateSingleNSPayload(poId);