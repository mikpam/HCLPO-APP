import type { Express } from "express";
import { validatorHealthService } from "../services/validator-health";

export function registerValidatorHealthRoutes(app: Express): void {
  
  // Get current health status
  app.get('/api/validator-health', async (req, res) => {
    try {
      const healthReport = validatorHealthService.getHealthReport();
      res.json(healthReport);
    } catch (error) {
      console.error('Error getting validator health:', error);
      res.status(500).json({ 
        error: 'Failed to get validator health status',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Force health check
  app.post('/api/validator-health/check', async (req, res) => {
    try {
      console.log('🏥 MANUAL HEALTH CHECK: Forcing validator health checks...');
      
      // Trigger immediate health checks
      await validatorHealthService['performHealthChecks']();
      
      const healthReport = validatorHealthService.getHealthReport();
      res.json({
        message: 'Health check completed',
        healthReport
      });
    } catch (error) {
      console.error('Error performing health check:', error);
      res.status(500).json({ 
        error: 'Failed to perform health check',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Test validator creation and recovery
  app.post('/api/validator-health/test-recovery', async (req, res) => {
    try {
      const { validatorType, maxRetries } = req.body;
      
      if (!validatorType || !['sku', 'contact', 'customer'].includes(validatorType)) {
        return res.status(400).json({ 
          error: 'Invalid validator type. Must be one of: sku, contact, customer' 
        });
      }

      console.log(`🧪 RECOVERY TEST: Testing ${validatorType} validator recovery...`);
      
      const validator = await validatorHealthService.createValidatorWithRetry(
        validatorType,
        maxRetries || 3
      );

      res.json({
        message: `Successfully created and tested ${validatorType} validator`,
        validatorType,
        success: true
      });
    } catch (error) {
      console.error('Error testing validator recovery:', error);
      res.status(500).json({ 
        error: 'Failed to test validator recovery',
        details: error instanceof Error ? error.message : 'Unknown error',
        validatorType: req.body.validatorType
      });
    }
  });

  // Get health metrics for dashboard
  app.get('/api/validator-health/metrics', async (req, res) => {
    try {
      const healthReport = validatorHealthService.getHealthReport();
      
      // Transform into dashboard-friendly metrics
      const metrics = {
        overall: {
          status: healthReport.systemHealth,
          lastUpdated: healthReport.lastUpdated
        },
        validators: {
          skuValidator: {
            healthy: healthReport.skuValidator.isHealthy,
            successRate: healthReport.skuValidator.successRate,
            avgResponseTime: healthReport.skuValidator.averageResponseTime,
            consecutiveFailures: healthReport.skuValidator.consecutiveFailures,
            totalCalls: healthReport.skuValidator.totalCalls
          },
          contactValidator: {
            healthy: healthReport.contactValidator.isHealthy,
            successRate: healthReport.contactValidator.successRate,
            avgResponseTime: healthReport.contactValidator.averageResponseTime,
            consecutiveFailures: healthReport.contactValidator.consecutiveFailures,
            totalCalls: healthReport.contactValidator.totalCalls
          },
          customerFinder: {
            healthy: healthReport.customerFinder.isHealthy,
            successRate: healthReport.customerFinder.successRate,
            avgResponseTime: healthReport.customerFinder.averageResponseTime,
            consecutiveFailures: healthReport.customerFinder.consecutiveFailures,
            totalCalls: healthReport.customerFinder.totalCalls
          }
        }
      };

      res.json(metrics);
    } catch (error) {
      console.error('Error getting validator metrics:', error);
      res.status(500).json({ 
        error: 'Failed to get validator metrics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}