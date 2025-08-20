/**
 * Memory monitoring utilities based on OpenAI recommendations
 */

export interface MemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  arrayBuffersMB: number;
  timestamp: Date;
}

export function getMemoryStats(): MemoryStats {
  const usage = process.memoryUsage();
  return {
    heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100,
    heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100,
    rssMB: Math.round(usage.rss / 1024 / 1024 * 100) / 100,
    externalMB: Math.round(usage.external / 1024 / 1024 * 100) / 100,
    arrayBuffersMB: Math.round(usage.arrayBuffers / 1024 / 1024 * 100) / 100,
    timestamp: new Date()
  };
}

export function logMemoryUsage(context: string): void {
  const stats = getMemoryStats();
  console.log(`🧠 MEMORY [${context}]: Heap ${stats.heapUsedMB}MB / RSS ${stats.rssMB}MB`);
}

export class MemoryGuard {
  private softLimitMB: number;
  private hardLimitMB: number;
  private lastCheck = 0;
  private checkInterval = 2000; // 2 seconds

  constructor(softLimitMB = 700, hardLimitMB = 900) {
    this.softLimitMB = softLimitMB;
    this.hardLimitMB = hardLimitMB;
  }

  checkMemoryPressure(): { status: 'ok' | 'pressure' | 'critical'; stats: MemoryStats } {
    const stats = getMemoryStats();
    
    if (stats.heapUsedMB > this.hardLimitMB) {
      return { status: 'critical', stats };
    } else if (stats.heapUsedMB > this.softLimitMB) {
      return { status: 'pressure', stats };
    }
    
    return { status: 'ok', stats };
  }

  shouldPauseProcessing(): boolean {
    const now = Date.now();
    if (now - this.lastCheck < this.checkInterval) {
      return false; // Don't check too frequently
    }
    this.lastCheck = now;

    const { status } = this.checkMemoryPressure();
    return status !== 'ok';
  }

  getRecommendedBatchSize(currentBatchSize: number): number {
    const { status, stats } = this.checkMemoryPressure();
    
    if (status === 'critical') {
      return Math.max(10, Math.floor(currentBatchSize / 4));
    } else if (status === 'pressure') {
      return Math.max(10, Math.floor(currentBatchSize / 2));
    } else if (stats.heapUsedMB < this.softLimitMB * 0.6) {
      return Math.min(200, currentBatchSize + 10);
    }
    
    return currentBatchSize;
  }
}

export const memoryGuard = new MemoryGuard();