import { customerLookupService } from "./customer-lookup";
import { storage } from "../storage";
import type { PurchaseOrder } from "@shared/schema";

/**
 * Integration service for connecting customer lookup with purchase order processing
 */
export class CustomerIntegrationService {
  /**
   * Enhanced purchase order processing with customer validation
   */
  async enrichPurchaseOrderWithCustomer(purchaseOrder: PurchaseOrder): Promise<{
    validatedCustomerNumber: string | null;
    customerMatch: any;
    confidenceLevel: 'high' | 'medium' | 'low' | 'none';
    shouldReview: boolean;
  }> {
    const extractedData = purchaseOrder.extractedData as any;
    
    // Extract customer information from Gemini data
    const geminiCustomer = extractedData?.purchaseOrder?.customer || {};
    const geminiShipTo = extractedData?.purchaseOrder?.shipTo || {};
    
    const lookupInput = {
      customerNumber: geminiCustomer.customerNumber,
      companyName: geminiCustomer.company || geminiShipTo.company,
      email: geminiCustomer.email || purchaseOrder.sender
    };

    console.log(`🔍 Customer lookup for PO ${purchaseOrder.poNumber}:`, lookupInput);

    // Perform customer lookup
    const lookupResult = await customerLookupService.lookupCustomer(lookupInput);
    
    let confidenceLevel: 'high' | 'medium' | 'low' | 'none';
    let shouldReview = false;

    if (lookupResult.confidence >= 0.95) {
      confidenceLevel = 'high';
    } else if (lookupResult.confidence >= 0.8) {
      confidenceLevel = 'medium';
      shouldReview = true; // Medium confidence should be reviewed
    } else if (lookupResult.confidence >= 0.6) {
      confidenceLevel = 'low';
      shouldReview = true;
    } else {
      confidenceLevel = 'none';
      shouldReview = true;
    }

    console.log(`   └─ Result: ${lookupResult.method} (confidence: ${lookupResult.confidence.toFixed(2)})`);
    if (lookupResult.customer) {
      console.log(`   └─ Matched: ${lookupResult.customer.customerNumber} - ${lookupResult.customer.companyName}`);
    }

    return {
      validatedCustomerNumber: lookupResult.customer?.customerNumber || null,
      customerMatch: lookupResult,
      confidenceLevel,
      shouldReview
    };
  }

  /**
   * Update purchase order with validated customer information
   */
  async updatePurchaseOrderWithCustomerData(
    purchaseOrderId: string,
    customerValidation: any
  ): Promise<void> {
    try {
      // Get current purchase order
      const currentPO = await storage.getPurchaseOrder(purchaseOrderId);
      if (!currentPO) {
        throw new Error(`Purchase order ${purchaseOrderId} not found`);
      }

      // Update customer metadata
      const updatedCustomerMeta = {
        validatedCustomerNumber: customerValidation.validatedCustomerNumber,
        lookupMethod: customerValidation.customerMatch.method,
        lookupConfidence: customerValidation.customerMatch.confidence,
        confidenceLevel: customerValidation.confidenceLevel,
        needsReview: customerValidation.shouldReview,
        matchedCustomer: customerValidation.customerMatch.customer,
        validatedAt: new Date().toISOString()
      };

      // Update the purchase order
      await storage.updatePurchaseOrder(purchaseOrderId, {
        customerMeta: updatedCustomerMeta,
        status: customerValidation.shouldReview ? 'pending_review' : currentPO.status
      });

      console.log(`✅ Updated PO ${currentPO.poNumber} with customer validation`);
    } catch (error) {
      console.error(`❌ Failed to update PO with customer data:`, error);
      throw error;
    }
  }

  /**
   * Batch process existing purchase orders for customer validation
   */
  async validateAllPurchaseOrders(): Promise<{
    processed: number;
    matched: number;
    needsReview: number;
    errors: number;
  }> {
    console.log('🔄 Starting batch customer validation for all purchase orders...');
    
    const allPOs = await storage.getPurchaseOrders();
    const stats = { processed: 0, matched: 0, needsReview: 0, errors: 0 };

    for (const po of allPOs) {
      try {
        const validation = await this.enrichPurchaseOrderWithCustomer(po);
        await this.updatePurchaseOrderWithCustomerData(po.id, validation);
        
        stats.processed++;
        if (validation.validatedCustomerNumber) {
          stats.matched++;
        }
        if (validation.shouldReview) {
          stats.needsReview++;
        }
      } catch (error) {
        console.error(`Error processing PO ${po.poNumber}:`, error);
        stats.errors++;
      }
    }

    console.log(`✅ Batch validation complete:`, stats);
    return stats;
  }
}

export const customerIntegrationService = new CustomerIntegrationService();