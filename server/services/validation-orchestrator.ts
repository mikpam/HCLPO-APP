import { HybridCustomerValidator } from './hybrid-customer-validator';
import { OpenAIContactValidatorService } from './openai-contact-validator';
import { OpenAISKUValidatorService } from './openai-sku-validator';
import { ValidatorHealthService } from './validator-health';
import { generateNSPayload } from './ns-payload-generator';
import type { StandardValidationResult, ValidationInput, ValidationResult, POStatus } from '../types/validation';

/**
 * Unified Validation Orchestrator
 * Central coordination point for all validation operations
 * Eliminates duplicate validators and ensures consistent results
 */
export class ValidationOrchestrator {
  private customerValidator: HybridCustomerValidator;
  private contactValidator: OpenAIContactValidatorService;
  private skuValidator: OpenAISKUValidatorService;
  private healthService: ValidatorHealthService;

  constructor(healthService?: ValidatorHealthService) {
    this.healthService = healthService || new ValidatorHealthService();
    this.customerValidator = new HybridCustomerValidator();
    this.contactValidator = new OpenAIContactValidatorService();
    this.skuValidator = new OpenAISKUValidatorService();
  }

  /**
   * Main validation entry point - validates entire purchase order
   */
  async validatePurchaseOrder(input: ValidationInput): Promise<ValidationResult> {
    console.log('\n🎯 VALIDATION ORCHESTRATOR: Starting unified validation...');
    const startTime = Date.now();

    try {
      // Step 1: Parallel customer and contact validation (independent operations)
      const [customerResult, contactResult] = await Promise.all([
        this.validateCustomerWithHealth(input.customer),
        this.validateContactWithHealth(input.contact, input.customer?.customerNumber)
      ]);

      // Step 2: Sequential item validation (may depend on customer for pricing)
      const itemsResult = await this.validateItemsWithHealth(
        input.items || [],
        customerResult?.customerNumber
      );

      // Step 3: Determine final status based on all validation results
      const status = this.determineStatus(customerResult, contactResult, itemsResult);

      // Step 4: Compile complete validation result
      const result: ValidationResult = {
        customer: customerResult,
        contact: contactResult,
        items: itemsResult,
        status,
        validationComplete: true,
        processingTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      console.log(`   ✅ Validation complete in ${result.processingTimeMs}ms`);
      console.log(`   └─ Status: ${status}`);
      console.log(`   └─ Customer: ${customerResult.matched ? 'Found' : 'Not found'} (${Math.round(customerResult.confidence * 100)}%)`);
      console.log(`   └─ Contact: ${contactResult.matched ? 'Found' : 'Not found'} (${Math.round(contactResult.confidence * 100)}%)`);
      console.log(`   └─ Items: ${itemsResult.validCount}/${itemsResult.totalCount} valid`);

      return result;

    } catch (error) {
      console.error('❌ VALIDATION ORCHESTRATOR ERROR:', error);
      throw error;
    }
  }

  /**
   * Validate customer with health monitoring
   */
  private async validateCustomerWithHealth(customerData: any): Promise<StandardValidationResult> {
    if (!customerData) {
      return this.createEmptyResult('customer');
    }

    try {
      const result = await this.healthService.recordValidatorCall(
        'customerValidator',
        async () => {
          const validationResult = await this.customerValidator.validateCustomer({
            customerName: customerData.company || customerData.customerName,
            customerEmail: customerData.email,
            senderEmail: customerData.senderEmail,
            customerNumber: customerData.customerNumber,
            netsuiteId: customerData.netsuiteId,
            address: customerData.address,
            contactName: customerData.contactName
          });

          // Convert to standard format
          return {
            matched: validationResult.matched,
            confidence: validationResult.confidence,
            method: validationResult.method,
            customerNumber: validationResult.customerNumber,
            customerName: validationResult.customerName,
            data: validationResult,
            errors: validationResult.matched ? undefined : validationResult.reasons,
            alternatives: validationResult.alternatives
          };
        }
      );

      return result;
    } catch (error) {
      console.error('Customer validation error:', error);
      return this.createErrorResult('customer', error);
    }
  }

  /**
   * Validate contact with health monitoring
   */
  private async validateContactWithHealth(contactData: any, customerNumber?: string): Promise<StandardValidationResult> {
    if (!contactData && !customerNumber) {
      return this.createEmptyResult('contact');
    }

    try {
      const result = await this.healthService.recordValidatorCall(
        'contactValidator',
        async () => {
          const validationResult = await this.contactValidator.validateContact({
            extractedData: contactData?.extractedData,
            senderName: contactData?.name || contactData?.senderName,
            senderEmail: contactData?.email || contactData?.senderEmail,
            resolvedCustomerId: customerNumber,
            companyId: customerNumber
          });

          // Convert to standard format
          return {
            matched: validationResult.verified || false,
            confidence: validationResult.confidence || 0,
            method: validationResult.match_method || 'UNKNOWN',
            data: validationResult,
            contactName: validationResult.name,
            contactEmail: validationResult.email,
            contactRole: validationResult.role,
            errors: validationResult.verified ? undefined : validationResult.evidence,
            alternatives: []
          };
        }
      );

      return result;
    } catch (error) {
      console.error('Contact validation error:', error);
      return this.createErrorResult('contact', error);
    }
  }

  /**
   * Validate items/SKUs with health monitoring
   */
  private async validateItemsWithHealth(items: any[], customerNumber?: string): Promise<StandardValidationResult & { validCount: number; totalCount: number }> {
    if (!items || items.length === 0) {
      return {
        ...this.createEmptyResult('items'),
        validCount: 0,
        totalCount: 0
      };
    }

    try {
      const result = await this.healthService.recordValidatorCall(
        'skuValidator',
        async () => {
          const validatedItems = await this.skuValidator.validateLineItems(items);
          
          const validCount = validatedItems.filter((item: any) => 
            item.finalSKU && item.finalSKU !== 'OE-MISC' && item.finalSKU !== 'OE-MISC-CHARGE'
          ).length;

          return {
            matched: validCount === items.length,
            confidence: validCount / items.length,
            method: 'sku_validation',
            data: validatedItems,
            validCount,
            totalCount: items.length,
            errors: validCount < items.length ? [`${items.length - validCount} items could not be validated`] : undefined,
            alternatives: []
          };
        }
      );

      return result;
    } catch (error) {
      console.error('Items validation error:', error);
      return {
        ...this.createErrorResult('items', error),
        validCount: 0,
        totalCount: items.length
      };
    }
  }

  /**
   * Determine PO status based on validation results
   */
  private determineStatus(
    customer: StandardValidationResult,
    contact: StandardValidationResult,
    items: StandardValidationResult & { validCount?: number; totalCount?: number }
  ): POStatus {
    // Priority order for status determination
    if (!customer.matched) {
      return 'new_customer';
    }
    if (!contact.matched) {
      return 'missing_contact';
    }
    if (items.totalCount && items.validCount !== undefined && items.validCount < items.totalCount) {
      return 'invalid_items';
    }
    
    // All validations passed
    return 'ready_for_netsuite';
  }

  /**
   * Create empty result for missing data
   */
  private createEmptyResult(type: string): StandardValidationResult {
    return {
      matched: false,
      confidence: 0,
      method: 'no_data',
      data: null,
      errors: [`No ${type} data provided`],
      alternatives: []
    };
  }

  /**
   * Create error result for validation failures
   */
  private createErrorResult(type: string, error: any): StandardValidationResult {
    return {
      matched: false,
      confidence: 0,
      method: 'error',
      data: null,
      errors: [`${type} validation failed: ${error.message || 'Unknown error'}`],
      alternatives: []
    };
  }
}

// Export for use in routes
export default ValidationOrchestrator;