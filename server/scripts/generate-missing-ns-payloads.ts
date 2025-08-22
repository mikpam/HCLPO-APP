#!/usr/bin/env tsx

import { db } from "../db";
import { purchaseOrders } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { generateNSPayload } from "../services/ns-payload-generator";

async function generateMissingNSPayloads() {
  console.log("🔍 Looking for POs with status 'ready_for_netsuite' but missing NS payloads...");
  
  try {
    // Find all POs that are ready for NetSuite but don't have NS payloads
    const posMissingPayloads = await db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.status, "ready_for_netsuite"),
          isNull(purchaseOrders.nsPayload)
        )
      );
    
    console.log(`Found ${posMissingPayloads.length} POs missing NS payloads`);
    
    for (const po of posMissingPayloads) {
      console.log(`\n📦 Generating NS payload for PO ${po.poNumber} (ID: ${po.id})...`);
      
      try {
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
        
        console.log(`✅ NS payload generated for PO ${po.poNumber}`);
      } catch (error) {
        console.error(`❌ Failed to generate NS payload for PO ${po.poNumber}:`, error);
      }
    }
    
    console.log("\n✨ NS payload generation complete!");
    
    // Show summary
    const updatedPOs = await db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.status, "ready_for_netsuite"),
          isNull(purchaseOrders.nsPayload)
        )
      );
    
    console.log(`\n📊 Summary:`);
    console.log(`  - Total POs ready for NetSuite: ${posMissingPayloads.length + updatedPOs.length}`);
    console.log(`  - NS payloads generated: ${posMissingPayloads.length - updatedPOs.length}`);
    console.log(`  - Still missing NS payloads: ${updatedPOs.length}`);
    
  } catch (error) {
    console.error("Error generating missing NS payloads:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run the script
generateMissingNSPayloads();