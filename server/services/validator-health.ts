import { OpenAISKUValidatorService } from './openai-sku-validator';
import { OpenAIContactValidatorService } from './openai-contact-validator';
import { OpenAICustomerFinderService } from './openai-customer-finder';
import { storage } from '../storage';

interface ValidatorHealthStatus {
  isHealthy: boolean;
  lastSuccessTime: Date | null;
  lastErrorTime: Date | null;
  consecutiveFailures: number;
  averageResponseTime: number;
  totalCalls: number;
  successRate: number;
}

interface ValidatorHealthReport {
  skuValidator: ValidatorHealthStatus;
  contactValidator: ValidatorHealthStatus;
  customerFinder: ValidatorHealthStatus;
  systemHealth: 'healthy' | 'degraded' | 'critical';
  lastUpdated: Date;
}

interface ValidatorMetrics {
  startTime: number;
  endTime?: number;
  success: boolean;
  error?: string;
}

export class ValidatorHealthService {
  private static instance: ValidatorHealthService;
  private healthData: Map<string, ValidatorHealthStatus> = new Map();
  private readonly maxConsecutiveFailures = 3;
  private readonly healthCheckInterval = 30000; // 30 seconds
  private healthCheckTimer?: NodeJS.Timeout;

  constructor() {
    this.initializeHealthData();
    this.startHealthMonitoring();
  }

  static getInstance(): ValidatorHealthService {
    if (!ValidatorHealthService.instance) {
      ValidatorHealthService.instance = new ValidatorHealthService();
    }
    return ValidatorHealthService.instance;
  }

  private initializeHealthData(): void {
    const initialStatus: ValidatorHealthStatus = {
      isHealthy: true,
      lastSuccessTime: null,
      lastErrorTime: null,
      consecutiveFailures: 0,
      averageResponseTime: 0,
      totalCalls: 0,
      successRate: 100
    };

    this.healthData.set('skuValidator', { ...initialStatus });
    this.healthData.set('contactValidator', { ...initialStatus });
    this.healthData.set('customerFinder', { ...initialStatus });
  }

  private startHealthMonitoring(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.healthCheckInterval);
  }

  private async performHealthChecks(): Promise<void> {
    console.log('🏥 VALIDATOR HEALTH: Performing routine health checks...');

    // Check each validator type
    await this.checkSKUValidatorHealth();
    await this.checkContactValidatorHealth();
    await this.checkCustomerFinderHealth();

    // Log overall system health
    const report = this.getHealthReport();
    console.log(`🏥 SYSTEM HEALTH: ${report.systemHealth.toUpperCase()}`);
    
    if (report.systemHealth !== 'healthy') {
      await this.logHealthAlert(report);
    }
  }

  private async checkSKUValidatorHealth(): Promise<void> {
    try {
      const validator = new OpenAISKUValidatorService();
      const startTime = Date.now();
      
      // Simple health check with minimal data
      await validator.validateLineItems([{
        sku: 'HEALTH-CHECK',
        description: 'Health check item',
        quantity: 1,
        itemColor: 'N/A'
      }]);
      
      const responseTime = Date.now() - startTime;
      this.recordSuccess('skuValidator', responseTime);
    } catch (error) {
      this.recordFailure('skuValidator', error as Error);
    }
  }

  private async checkContactValidatorHealth(): Promise<void> {
    try {
      const validator = new OpenAIContactValidatorService();
      const startTime = Date.now();
      
      // Simple health check
      await validator.validateContact({
        extractedData: { purchaseOrder: { contact: { name: 'Health Check', email: 'health@check.com' } } },
        senderName: 'Health Check',
        senderEmail: 'health@check.com',
        resolvedCustomerId: 'HEALTH-CHECK',
        companyId: 'HEALTH-CHECK'
      });
      
      const responseTime = Date.now() - startTime;
      this.recordSuccess('contactValidator', responseTime);
    } catch (error) {
      this.recordFailure('contactValidator', error as Error);
    }
  }

  private async checkCustomerFinderHealth(): Promise<void> {
    try {
      const finder = new OpenAICustomerFinderService();
      const startTime = Date.now();
      
      // Simple health check
      await finder.findCustomer({
        customerName: 'Health Check Company',
        customerEmail: 'health@check.com',
        senderEmail: 'health@check.com'
      });
      
      const responseTime = Date.now() - startTime;
      this.recordSuccess('customerFinder', responseTime);
    } catch (error) {
      this.recordFailure('customerFinder', error as Error);
    }
  }

  private recordSuccess(validatorType: string, responseTime: number): void {
    const status = this.healthData.get(validatorType);
    if (!status) return;

    status.lastSuccessTime = new Date();
    status.consecutiveFailures = 0;
    status.isHealthy = true;
    status.totalCalls++;
    
    // Update average response time
    status.averageResponseTime = ((status.averageResponseTime * (status.totalCalls - 1)) + responseTime) / status.totalCalls;
    
    // Calculate success rate (simplified)
    const successCount = status.totalCalls - status.consecutiveFailures;
    status.successRate = (successCount / status.totalCalls) * 100;

    console.log(`🟢 ${validatorType}: Healthy (${responseTime}ms, ${status.successRate.toFixed(1)}% success rate)`);
  }

  private recordFailure(validatorType: string, error: Error): void {
    const status = this.healthData.get(validatorType);
    if (!status) return;

    status.lastErrorTime = new Date();
    status.consecutiveFailures++;
    status.totalCalls++;
    status.isHealthy = status.consecutiveFailures < this.maxConsecutiveFailures;
    
    // Calculate success rate
    const successCount = status.totalCalls - status.consecutiveFailures;
    status.successRate = (successCount / status.totalCalls) * 100;

    console.log(`🔴 ${validatorType}: ${status.isHealthy ? 'Degraded' : 'Critical'} (${status.consecutiveFailures} failures, ${status.successRate.toFixed(1)}% success rate)`);
    console.error(`   └─ Error: ${error.message}`);
  }

  public async recordValidatorCall(
    validatorType: string, 
    operation: () => Promise<any>
  ): Promise<any> {
    const startTime = Date.now();
    
    try {
      const result = await operation();
      const responseTime = Date.now() - startTime;
      this.recordSuccess(validatorType, responseTime);
      return result;
    } catch (error) {
      this.recordFailure(validatorType, error as Error);
      throw error;
    }
  }

  public getHealthReport(): ValidatorHealthReport {
    const skuValidator = this.healthData.get('skuValidator')!;
    const contactValidator = this.healthData.get('contactValidator')!;
    const customerFinder = this.healthData.get('customerFinder')!;

    // Determine overall system health
    let systemHealth: 'healthy' | 'degraded' | 'critical' = 'healthy';
    
    const unhealthyValidators = [skuValidator, contactValidator, customerFinder].filter(v => !v.isHealthy);
    
    if (unhealthyValidators.length >= 2) {
      systemHealth = 'critical';
    } else if (unhealthyValidators.length === 1) {
      systemHealth = 'degraded';
    }

    return {
      skuValidator,
      contactValidator,
      customerFinder,
      systemHealth,
      lastUpdated: new Date()
    };
  }

  private async logHealthAlert(report: ValidatorHealthReport): Promise<void> {
    try {
      // Log to error tracking system
      const alertMessage = `Validator health alert: System is ${report.systemHealth}`;
      
      const unhealthyValidators = [];
      if (!report.skuValidator.isHealthy) unhealthyValidators.push('SKU Validator');
      if (!report.contactValidator.isHealthy) unhealthyValidators.push('Contact Validator');
      if (!report.customerFinder.isHealthy) unhealthyValidators.push('Customer Finder');

      await storage.createErrorLog({
        type: 'validator_health_alert',
        message: alertMessage,
        explanation: `System health monitoring detected issues with validators: ${unhealthyValidators.join(', ')}. This may impact email processing reliability.`,
        relatedPoId: null,
        relatedPoNumber: null,
        resolved: false,
        metadata: {
          systemHealth: report.systemHealth,
          unhealthyValidators,
          healthReport: report,
          timestamp: new Date().toISOString()
        }
      });

      console.log(`🚨 HEALTH ALERT: ${alertMessage} - Logged to error tracking`);
    } catch (error) {
      console.error('Failed to log health alert:', error);
    }
  }

  public async createValidatorWithRetry<T>(
    validatorType: 'sku' | 'contact' | 'customer',
    maxRetries: number = 3,
    delayMs: number = 1000
  ): Promise<OpenAISKUValidatorService | OpenAIContactValidatorService | OpenAICustomerFinderService> {
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        let validator: any;
        
        switch (validatorType) {
          case 'sku':
            validator = new OpenAISKUValidatorService();
            break;
          case 'contact':
            validator = new OpenAIContactValidatorService();
            break;
          case 'customer':
            validator = new OpenAICustomerFinderService();
            break;
        }

        // Quick health check on the new validator
        if (validatorType === 'sku') {
          await validator.validateLineItems([]);
        } else if (validatorType === 'contact') {
          // Just initialize, don't call validate with empty data
        } else if (validatorType === 'customer') {
          // Just initialize, don't call find with empty data
        }

        console.log(`✅ VALIDATOR RECOVERY: Successfully created ${validatorType} validator (attempt ${attempt})`);
        return validator;
        
      } catch (error) {
        console.error(`❌ VALIDATOR RECOVERY: Attempt ${attempt} failed for ${validatorType} validator:`, error);
        
        if (attempt === maxRetries) {
          console.error(`🚨 VALIDATOR RECOVERY: All ${maxRetries} attempts failed for ${validatorType} validator`);
          throw new Error(`Failed to create ${validatorType} validator after ${maxRetries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }

    throw new Error(`Unexpected error in validator creation for ${validatorType}`);
  }

  public stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }
}

// Export singleton instance
export const validatorHealthService = ValidatorHealthService.getInstance();