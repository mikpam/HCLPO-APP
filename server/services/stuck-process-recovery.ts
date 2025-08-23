/**
 * Stuck Process Recovery Service
 * 
 * Handles detection and recovery of stuck purchase orders in the processing pipeline.
 * Implements:
 * 1. Timeout detection for transitional states
 * 2. Dead letter queue pattern for repeated failures
 * 3. Automatic status correction
 */

import { db } from '../db';
import { purchaseOrders } from '@shared/schema';
import { and, eq, sql, inArray, lt, or, isNull } from 'drizzle-orm';

// Configuration
const TIMEOUT_MINUTES = {
  extracting: 10,     // 10 minutes for extraction
  pending_validation: 5, // 5 minutes to start validation
  validating: 5,      // 5 minutes for validation  
  processing: 15,     // 15 minutes for general processing
  importing: 10       // 10 minutes for NetSuite import
};

const MAX_FAILURES = 3; // Move to dead letter after 3 failures
const TRANSITIONAL_STATES = ['extracting', 'pending_validation', 'validating', 'processing', 'importing'];

interface StuckPO {
  id: string;
  poNumber: string;
  status: string;
  processingStartedAt: Date | null;
  statusChangedAt: Date | null;
  failureCount: number;
  lastError: string | null;
}

/**
 * Check for stuck processes and recover them
 */
export async function checkAndRecoverStuckProcesses(): Promise<{
  recovered: number;
  deadLettered: number;
  details: Array<{ id: string; poNumber: string; action: string; reason: string }>
}> {
  const details: Array<{ id: string; poNumber: string; action: string; reason: string }> = [];
  let recovered = 0;
  let deadLettered = 0;

  console.log('🔍 STUCK PROCESS CHECK: Scanning for stuck purchase orders...');

  try {
    // Get current time
    const now = new Date();

    // Check each transitional state for timeouts
    for (const state of TRANSITIONAL_STATES) {
      const timeoutMinutes = TIMEOUT_MINUTES[state as keyof typeof TIMEOUT_MINUTES] || 10;
      const timeoutThreshold = new Date(now.getTime() - timeoutMinutes * 60 * 1000);

      // Find stuck POs in this state
      const stuckPOs = await db
        .select({
          id: purchaseOrders.id,
          poNumber: purchaseOrders.poNumber,
          status: purchaseOrders.status,
          processingStartedAt: purchaseOrders.processingStartedAt,
          statusChangedAt: purchaseOrders.statusChangedAt,
          failureCount: purchaseOrders.failureCount,
          lastError: purchaseOrders.lastError,
          customerValidated: purchaseOrders.customerValidated,
          contactValidated: purchaseOrders.contactValidated,
          lineItemsValidated: purchaseOrders.lineItemsValidated,
          extractedData: purchaseOrders.extractedData,
          route: purchaseOrders.route
        })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.status, state),
            or(
              // Check processing started timestamp
              and(
                purchaseOrders.processingStartedAt !== null,
                lt(purchaseOrders.processingStartedAt, timeoutThreshold)
              ),
              // Fallback to status changed timestamp
              and(
                isNull(purchaseOrders.processingStartedAt),
                lt(purchaseOrders.statusChangedAt, timeoutThreshold)
              )
            )
          )
        );

      console.log(`   └─ Found ${stuckPOs.length} stuck POs in '${state}' status`);

      for (const po of stuckPOs) {
        const minutesStuck = Math.round(
          (now.getTime() - (po.processingStartedAt || po.statusChangedAt || now).getTime()) / 60000
        );

        // Increment failure count
        const newFailureCount = (po.failureCount || 0) + 1;

        // Decide action based on failure count
        if (newFailureCount >= MAX_FAILURES) {
          // Move to dead letter queue
          await db
            .update(purchaseOrders)
            .set({
              status: 'manual_review',
              failureCount: newFailureCount,
              lastError: `Stuck in ${state} for ${minutesStuck} minutes`,
              deadLetterReason: `Exceeded max failures (${MAX_FAILURES}) - stuck in ${state} state`,
              errorReason: `Processing timeout - stuck in ${state} state`,
              statusChangedAt: now,
              processingStartedAt: null
            })
            .where(eq(purchaseOrders.id, po.id));

          deadLettered++;
          details.push({
            id: po.id,
            poNumber: po.poNumber,
            action: 'dead_lettered',
            reason: `Stuck in ${state} for ${minutesStuck}min, failure #${newFailureCount}`
          });

          console.log(`   ⚰️ DEAD LETTER: PO ${po.poNumber} moved to manual_review (${newFailureCount} failures)`);
        } else {
          // Recover to appropriate status based on state and validation
          let newStatus = 'pending_review';
          
          // Determine recovery status based on context
          if (state === 'extracting') {
            // Check if extraction completed
            if (po.extractedData) {
              // Has extraction data, determine status based on validation
              if (!po.customerValidated) {
                newStatus = 'new_customer';
              } else if (po.customerValidated && po.contactValidated && po.lineItemsValidated) {
                newStatus = 'ready_for_netsuite';
              } else {
                newStatus = 'pending_review';
              }
            } else {
              // No extraction data, needs review
              newStatus = 'extraction_failed';
            }
          } else if (state === 'validating') {
            // Validation incomplete
            if (!po.customerValidated) {
              newStatus = 'new_customer';
            } else {
              newStatus = 'pending_review';
            }
          } else if (state === 'importing') {
            // Import failed, needs retry
            newStatus = 'ready_for_netsuite';
          }

          // Special handling for sample and fallback routes
          if (po.route?.includes('SAMPLE') || po.route?.includes('FALLBACK')) {
            newStatus = 'pending_review';
          }

          await db
            .update(purchaseOrders)
            .set({
              status: newStatus,
              failureCount: newFailureCount,
              lastError: `Recovered from stuck ${state} state after ${minutesStuck} minutes`,
              statusChangedAt: now,
              processingStartedAt: null
            })
            .where(eq(purchaseOrders.id, po.id));

          recovered++;
          details.push({
            id: po.id,
            poNumber: po.poNumber,
            action: 'recovered',
            reason: `Stuck in ${state} for ${minutesStuck}min → ${newStatus}`
          });

          console.log(`   ✅ RECOVERED: PO ${po.poNumber} from ${state} → ${newStatus}`);
        }
      }
    }

    // Also check for POs that have been in error state too long
    const errorThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours
    const longErrorPOs = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        failureCount: purchaseOrders.failureCount
      })
      .from(purchaseOrders)
      .where(
        and(
          inArray(purchaseOrders.status, ['error', 'extraction_failed', 'validation_failed']),
          lt(purchaseOrders.statusChangedAt, errorThreshold),
          lt(purchaseOrders.failureCount, MAX_FAILURES)
        )
      );

    for (const po of longErrorPOs) {
      await db
        .update(purchaseOrders)
        .set({
          status: 'manual_review',
          deadLetterReason: 'In error state for over 24 hours',
          errorReason: 'Processing error - stuck in error state',
          statusChangedAt: now
        })
        .where(eq(purchaseOrders.id, po.id));

      deadLettered++;
      details.push({
        id: po.id,
        poNumber: po.poNumber,
        action: 'dead_lettered',
        reason: 'Error state > 24 hours'
      });
    }

    const summary = `Recovered ${recovered} stuck POs, moved ${deadLettered} to dead letter queue`;
    if (recovered > 0 || deadLettered > 0) {
      console.log(`🔧 STUCK PROCESS RECOVERY: ${summary}`);
    }

    return { recovered, deadLettered, details };
  } catch (error) {
    console.error('❌ STUCK PROCESS CHECK ERROR:', error);
    throw error;
  }
}

/**
 * Get dead letter queue statistics
 */
export async function getDeadLetterStats(): Promise<{
  total: number;
  byReason: Record<string, number>;
  oldest: Date | null;
  averageFailures: number;
}> {
  const deadLetterPOs = await db
    .select({
      id: purchaseOrders.id,
      deadLetterReason: purchaseOrders.deadLetterReason,
      statusChangedAt: purchaseOrders.statusChangedAt,
      failureCount: purchaseOrders.failureCount
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.status, 'manual_review'));

  const byReason: Record<string, number> = {};
  let totalFailures = 0;
  let oldest: Date | null = null;

  for (const po of deadLetterPOs) {
    const reason = po.deadLetterReason || 'Unknown';
    byReason[reason] = (byReason[reason] || 0) + 1;
    totalFailures += po.failureCount || 0;
    
    if (!oldest || (po.statusChangedAt && po.statusChangedAt < oldest)) {
      oldest = po.statusChangedAt;
    }
  }

  return {
    total: deadLetterPOs.length,
    byReason,
    oldest,
    averageFailures: deadLetterPOs.length > 0 ? totalFailures / deadLetterPOs.length : 0
  };
}

/**
 * Manually retry a dead letter PO
 */
export async function retryDeadLetterPO(poId: string): Promise<{ success: boolean; message: string }> {
  try {
    const po = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, poId))
      .limit(1);

    if (!po.length) {
      return { success: false, message: 'PO not found' };
    }

    // Allow retry for ANY status, not just manual_review
    console.log(`🔄 MANUAL RETRY: Retrying PO ${po[0].poNumber} (current status: ${po[0].status})`);

    // Reset for retry - always start from pending to reprocess fully
    const newStatus = 'pending';
    
    await db
      .update(purchaseOrders)
      .set({
        status: newStatus,
        failureCount: 0,
        lastError: null,
        deadLetterReason: null,
        processingStartedAt: new Date(),
        statusChangedAt: new Date(),
        retryCount: (po[0].retryCount || 0) + 1,
        lastRetryAt: new Date()
      })
      .where(eq(purchaseOrders.id, poId));

    return { success: true, message: `PO ${po[0].poNumber} reset to ${newStatus} for complete reprocessing` };
  } catch (error) {
    console.error('Error retrying PO:', error);
    return { success: false, message: 'Failed to retry PO' };
  }
}

/**
 * Generate daily report of stuck/failed items
 */
export async function generateDailyReport(): Promise<{
  date: string;
  summary: {
    totalStuck: number;
    totalDeadLetter: number;
    totalErrors: number;
    oldestStuck: Date | null;
  };
  stuckByStatus: Record<string, number>;
  deadLetterByReason: Record<string, number>;
  recentFailures: Array<{
    poNumber: string;
    status: string;
    lastError: string | null;
    failureCount: number;
    stuckSince: Date | null;
  }>;
}> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  console.log('📊 DAILY REPORT: Generating stuck/failed items report...');
  
  try {
    // Get all stuck POs (in transitional states)
    const stuckPOs = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        statusChangedAt: purchaseOrders.statusChangedAt,
        lastError: purchaseOrders.lastError,
        failureCount: purchaseOrders.failureCount
      })
      .from(purchaseOrders)
      .where(
        inArray(purchaseOrders.status, TRANSITIONAL_STATES)
      );
    
    // Get all dead letter POs
    const deadLetterPOs = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        deadLetterReason: purchaseOrders.deadLetterReason,
        statusChangedAt: purchaseOrders.statusChangedAt,
        lastError: purchaseOrders.lastError,
        failureCount: purchaseOrders.failureCount
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.status, 'manual_review'));
    
    // Get all error POs
    const errorPOs = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        statusChangedAt: purchaseOrders.statusChangedAt,
        lastError: purchaseOrders.lastError,
        failureCount: purchaseOrders.failureCount
      })
      .from(purchaseOrders)
      .where(
        inArray(purchaseOrders.status, ['error', 'extraction_failed', 'validation_failed'])
      );
    
    // Calculate stuck by status
    const stuckByStatus: Record<string, number> = {};
    stuckPOs.forEach(po => {
      stuckByStatus[po.status] = (stuckByStatus[po.status] || 0) + 1;
    });
    
    // Calculate dead letter by reason
    const deadLetterByReason: Record<string, number> = {};
    deadLetterPOs.forEach(po => {
      const reason = po.deadLetterReason || 'Unknown';
      deadLetterByReason[reason] = (deadLetterByReason[reason] || 0) + 1;
    });
    
    // Get recent failures (last 24 hours or top 10)
    const allProblematicPOs = [...stuckPOs, ...deadLetterPOs, ...errorPOs]
      .sort((a, b) => {
        const dateA = a.statusChangedAt || new Date(0);
        const dateB = b.statusChangedAt || new Date(0);
        return dateB.getTime() - dateA.getTime();
      })
      .slice(0, 10);
    
    const recentFailures = allProblematicPOs.map(po => ({
      poNumber: po.poNumber,
      status: po.status,
      lastError: po.lastError,
      failureCount: po.failureCount || 0,
      stuckSince: po.statusChangedAt
    }));
    
    // Find oldest stuck PO
    let oldestStuck: Date | null = null;
    [...stuckPOs, ...deadLetterPOs, ...errorPOs].forEach(po => {
      if (po.statusChangedAt && (!oldestStuck || po.statusChangedAt < oldestStuck)) {
        oldestStuck = po.statusChangedAt;
      }
    });
    
    const report = {
      date: now.toISOString().split('T')[0],
      summary: {
        totalStuck: stuckPOs.length,
        totalDeadLetter: deadLetterPOs.length,
        totalErrors: errorPOs.length,
        oldestStuck
      },
      stuckByStatus,
      deadLetterByReason,
      recentFailures
    };
    
    // Log summary to console
    console.log(`📊 DAILY REPORT SUMMARY (${report.date}):`);
    console.log(`   └─ Stuck in processing: ${report.summary.totalStuck}`);
    console.log(`   └─ In dead letter queue: ${report.summary.totalDeadLetter}`);
    console.log(`   └─ In error state: ${report.summary.totalErrors}`);
    
    if (report.summary.totalStuck > 0) {
      console.log('   └─ Stuck by status:');
      Object.entries(stuckByStatus).forEach(([status, count]) => {
        console.log(`      • ${status}: ${count}`);
      });
    }
    
    if (report.summary.totalDeadLetter > 0) {
      console.log('   └─ Dead letter reasons:');
      Object.entries(deadLetterByReason).forEach(([reason, count]) => {
        console.log(`      • ${reason}: ${count}`);
      });
    }
    
    return report;
  } catch (error) {
    console.error('❌ DAILY REPORT ERROR:', error);
    throw error;
  }
}