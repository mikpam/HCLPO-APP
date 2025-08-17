import { validatorHealthService } from './validator-health';
import { OpenAICustomerFinderService } from './openai-customer-finder';
import { OpenAIContactValidatorService } from './openai-contact-validator';
import { OpenAISKUValidatorService } from './openai-sku-validator';

/**
 * Health-monitored validator factory functions
 * These wrap validator creation with health monitoring and circuit breaker patterns
 */

export async function createHealthMonitoredCustomerFinder(): Promise<OpenAICustomerFinderService> {
  return await validatorHealthService.recordValidatorCall(
    'customerFinder',
    async () => new OpenAICustomerFinderService()
  );
}

export async function createHealthMonitoredContactValidator(): Promise<OpenAIContactValidatorService> {
  return await validatorHealthService.recordValidatorCall(
    'contactValidator',
    async () => new OpenAIContactValidatorService()
  );
}

export async function createHealthMonitoredSKUValidator(): Promise<OpenAISKUValidatorService> {
  return await validatorHealthService.recordValidatorCall(
    'skuValidator',
    async () => new OpenAISKUValidatorService()
  );
}

/**
 * Health check function for all validators
 * Tests basic functionality without actual API calls
 */
export async function validateAllValidatorHealth(): Promise<{
  customerFinder: boolean;
  contactValidator: boolean;
  skuValidator: boolean;
  overall: boolean;
}> {
  const results = {
    customerFinder: false,
    contactValidator: false,
    skuValidator: false,
    overall: false
  };

  try {
    // Test customer finder creation
    const customerFinder = await createHealthMonitoredCustomerFinder();
    results.customerFinder = !!customerFinder;
  } catch (error) {
    console.error('❌ Customer Finder health check failed:', error);
  }

  try {
    // Test contact validator creation
    const contactValidator = await createHealthMonitoredContactValidator();
    results.contactValidator = !!contactValidator;
  } catch (error) {
    console.error('❌ Contact Validator health check failed:', error);
  }

  try {
    // Test SKU validator creation
    const skuValidator = await createHealthMonitoredSKUValidator();
    results.skuValidator = !!skuValidator;
  } catch (error) {
    console.error('❌ SKU Validator health check failed:', error);
  }

  results.overall = results.customerFinder && results.contactValidator && results.skuValidator;
  
  return results;
}