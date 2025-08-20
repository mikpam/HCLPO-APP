import { execSync } from 'child_process';
import { db } from '../db';
import { sql } from 'drizzle-orm';

interface PerformanceMetrics {
  timestamp: Date;
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
    arrayBuffers: number;
  };
  storage: {
    databaseSizeMB: number;
    tempFilesMB: number;
  };
  processing: {
    emailsPerMinute: number;
    averageProcessingTime: number;
    currentQueueSize: number;
  };
  system: {
    cpuUsage: number;
    uptime: number;
  };
}

interface EmailProcessingMetric {
  emailId: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  success: boolean;
}

export class PerformanceMonitorService {
  private static instance: PerformanceMonitorService;
  private metrics: PerformanceMetrics[] = [];
  private emailProcessingTimes: EmailProcessingMetric[] = [];
  private readonly MAX_METRICS_HISTORY = 100; // Keep only last 100 data points for memory efficiency
  private readonly MAX_EMAIL_METRICS = 50; // Keep only last 50 email processing records

  static getInstance(): PerformanceMonitorService {
    if (!PerformanceMonitorService.instance) {
      PerformanceMonitorService.instance = new PerformanceMonitorService();
    }
    return PerformanceMonitorService.instance;
  }

  /**
   * LIGHTWEIGHT: Collect current performance metrics without heavy operations
   */
  async collectMetrics(): Promise<PerformanceMetrics> {
    try {
      const memoryUsage = process.memoryUsage();
      
      // Get database size efficiently
      const dbSizeResult = await db.execute(sql`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size_pretty,
               pg_database_size(current_database()) as size_bytes
      `);
      const dbSizeBytes = parseInt(dbSizeResult.rows[0]?.size_bytes) || 0;
      
      // Calculate email processing metrics from recent data
      const recentEmails = this.emailProcessingTimes.filter(
        email => email.endTime && email.endTime > new Date(Date.now() - 60000) // Last minute
      );
      
      const avgProcessingTime = recentEmails.length > 0 
        ? recentEmails.reduce((sum, email) => sum + (email.duration || 0), 0) / recentEmails.length
        : 0;

      // Get current queue size
      const queueResult = await db.execute(sql`
        SELECT COUNT(*) as count FROM email_queue WHERE status = 'pending'
      `);
      const currentQueueSize = parseInt(queueResult.rows[0]?.count) || 0;

      const metrics: PerformanceMetrics = {
        timestamp: new Date(),
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100, // MB
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100, // MB
          rss: Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100, // MB
          external: Math.round(memoryUsage.external / 1024 / 1024 * 100) / 100, // MB
          arrayBuffers: Math.round(memoryUsage.arrayBuffers / 1024 / 1024 * 100) / 100, // MB
        },
        storage: {
          databaseSizeMB: Math.round(dbSizeBytes / 1024 / 1024 * 100) / 100,
          tempFilesMB: 0, // Can be enhanced later if needed
        },
        processing: {
          emailsPerMinute: recentEmails.length,
          averageProcessingTime: Math.round(avgProcessingTime),
          currentQueueSize,
        },
        system: {
          cpuUsage: 0, // Can be enhanced with actual CPU monitoring if needed
          uptime: Math.round(process.uptime()),
        }
      };

      // Store metrics with size limit
      this.metrics.push(metrics);
      if (this.metrics.length > this.MAX_METRICS_HISTORY) {
        this.metrics = this.metrics.slice(-this.MAX_METRICS_HISTORY);
      }

      return metrics;
    } catch (error) {
      console.error('Error collecting performance metrics:', error);
      throw error;
    }
  }

  /**
   * Track email processing start
   */
  startEmailProcessing(emailId: string): void {
    this.emailProcessingTimes.push({
      emailId,
      startTime: new Date(),
      success: false
    });

    // Cleanup old records
    if (this.emailProcessingTimes.length > this.MAX_EMAIL_METRICS) {
      this.emailProcessingTimes = this.emailProcessingTimes.slice(-this.MAX_EMAIL_METRICS);
    }
  }

  /**
   * Track email processing end
   */
  endEmailProcessing(emailId: string, success: boolean = true): void {
    const metric = this.emailProcessingTimes.find(m => m.emailId === emailId && !m.endTime);
    if (metric) {
      metric.endTime = new Date();
      metric.duration = metric.endTime.getTime() - metric.startTime.getTime();
      metric.success = success;
    }
  }

  /**
   * Get recent metrics for dashboard
   */
  getRecentMetrics(limit: number = 20): PerformanceMetrics[] {
    return this.metrics.slice(-limit);
  }

  /**
   * Get email processing statistics
   */
  getEmailProcessingStats(): {
    totalProcessed: number;
    successRate: number;
    averageTime: number;
    recentTimes: number[];
  } {
    const completedEmails = this.emailProcessingTimes.filter(e => e.endTime);
    const successfulEmails = completedEmails.filter(e => e.success);
    
    const recentTimes = completedEmails
      .slice(-10)
      .map(e => e.duration || 0);

    return {
      totalProcessed: completedEmails.length,
      successRate: completedEmails.length > 0 ? (successfulEmails.length / completedEmails.length) * 100 : 0,
      averageTime: completedEmails.length > 0 
        ? completedEmails.reduce((sum, email) => sum + (email.duration || 0), 0) / completedEmails.length
        : 0,
      recentTimes
    };
  }

  /**
   * Get memory usage trend
   */
  getMemoryTrend(): { timestamps: string[], heapUsed: number[], rss: number[] } {
    const recent = this.metrics.slice(-20);
    return {
      timestamps: recent.map(m => m.timestamp.toLocaleTimeString()),
      heapUsed: recent.map(m => m.memory.heapUsed),
      rss: recent.map(m => m.memory.rss)
    };
  }

  /**
   * Check if system is under memory pressure
   */
  isMemoryPressure(): boolean {
    if (this.metrics.length === 0) return false;
    
    const latest = this.metrics[this.metrics.length - 1];
    const heapUsagePercent = (latest.memory.heapUsed / latest.memory.heapTotal) * 100;
    
    return heapUsagePercent > 85; // Alert if heap usage > 85%
  }

  /**
   * Get performance summary for dashboard
   */
  getPerformanceSummary(): {
    memoryUsageMB: number;
    memoryUsagePercent: number;
    databaseSizeMB: number;
    emailsPerMinute: number;
    averageProcessingTime: number;
    systemUptime: number;
    alerts: string[];
  } {
    if (this.metrics.length === 0) {
      return {
        memoryUsageMB: 0,
        memoryUsagePercent: 0,
        databaseSizeMB: 0,
        emailsPerMinute: 0,
        averageProcessingTime: 0,
        systemUptime: 0,
        alerts: ['No performance data available']
      };
    }

    const latest = this.metrics[this.metrics.length - 1];
    const alerts: string[] = [];

    // Check for alerts
    if (this.isMemoryPressure()) {
      alerts.push('High memory usage detected');
    }
    if (latest.processing.currentQueueSize > 10) {
      alerts.push('Email queue backlog detected');
    }
    if (latest.processing.averageProcessingTime > 30000) {
      alerts.push('Slow email processing detected');
    }

    return {
      memoryUsageMB: latest.memory.heapUsed,
      memoryUsagePercent: (latest.memory.heapUsed / latest.memory.heapTotal) * 100,
      databaseSizeMB: latest.storage.databaseSizeMB,
      emailsPerMinute: latest.processing.emailsPerMinute,
      averageProcessingTime: latest.processing.averageProcessingTime,
      systemUptime: latest.system.uptime,
      alerts
    };
  }
}

// Export singleton instance
export const performanceMonitor = PerformanceMonitorService.getInstance();