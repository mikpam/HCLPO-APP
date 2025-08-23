#!/usr/bin/env node
import { db } from "../db.js";
import { purchaseOrders } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { ValidationOrchestrator } from "../services/validation-orchestrator.js";
import { ValidatorHealthService } from "../services/validator-health.js";

async function reprocessContactFailedPOs() {
  console.log("📊 Reprocessing POs that failed contact validation...");
  
  try {
    // Initialize services
    const healthService = new ValidatorHealthService();
    const orchestrator = new ValidationOrchestrator(healthService);
    
    // Get all manual_review POs with contact validation failure
    const contactFailedPOs = await db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.status, "manual_review"),
          eq(purchaseOrders.errorReason, "Contact validation failed")
        )
      );
    
    console.log(`Found ${contactFailedPOs.length} POs with contact validation failures`);
    
    let updatedCount = 0;
    let stillFailedCount = 0;
    
    for (const po of contactFailedPOs) {
      console.log(`\n🔄 Reprocessing PO ${po.poNumber}...`);
      
      const extractedData = po.extractedData as any;
      if (!extractedData) {
        console.log(`  ⚠️ No extracted data, skipping`);
        continue;
      }
      
      // Prepare validation input from extracted data
      const purchaseOrder = extractedData.purchaseOrder || extractedData;
      const validationInput = {
        purchaseOrderId: po.id,
        customer: purchaseOrder?.customer,
        contact: purchaseOrder?.contact,
        items: purchaseOrder?.lineItems || extractedData?.lineItems || [],
        extractedData
      };
      
      // Run validation orchestration
      const validationResult = await orchestrator.validatePurchaseOrder(validationInput);
      
      console.log(`  📊 Validation result: ${validationResult.status}`);
      console.log(`     Customer: ${validationResult.customer.matched ? '✅' : '❌'} (${validationResult.customer.customerNumber || 'No C#'})`);
      console.log(`     Contact: ${validationResult.contact.matched ? '✅' : '❌'}`);
      console.log(`     Items: ${validationResult.items.validCount}/${validationResult.items.totalCount} valid`);
      
      // Update PO status based on new validation
      if (validationResult.status === 'ready_for_netsuite') {
        await db
          .update(purchaseOrders)
          .set({
            status: 'ready_for_netsuite',
            errorReason: null,
            customerValidated: true,
            contactValidated: true,
            lineItemsValidated: true,
            validationCompleted: true
          })
          .where(eq(purchaseOrders.id, po.id));
        
        console.log(`  ✅ Updated to ready_for_netsuite!`);
        updatedCount++;
      } else if (validationResult.status === 'invalid_items') {
        await db
          .update(purchaseOrders)
          .set({
            status: 'invalid_items',
            errorReason: 'Invalid or missing item SKUs',
            customerValidated: true,
            contactValidated: true,
            lineItemsValidated: false
          })
          .where(eq(purchaseOrders.id, po.id));
        
        console.log(`  ⚠️ Has invalid items`);
      } else {
        console.log(`  ❌ Still requires manual review: ${validationResult.status}`);
        stillFailedCount++;
      }
    }
    
    console.log(`\n✅ Reprocessing complete:`);
    console.log(`   - ${updatedCount} POs moved to ready_for_netsuite`);
    console.log(`   - ${stillFailedCount} POs still require manual review`);
    
  } catch (error) {
    console.error("❌ Error reprocessing POs:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

reprocessContactFailedPOs();