// 🔥 SHARED PROCESSING STATUS TRACKING
// This module provides centralized processing status tracking for the entire system

export interface ProcessingStatus {
  isProcessing: boolean;
  currentStep: string;
  currentEmail: string;
  currentPO: string;
  emailNumber: number;
  totalEmails: number;
}

let currentProcessingStatus: ProcessingStatus = {
  isProcessing: false,
  currentStep: "",
  currentEmail: "",
  currentPO: "",
  emailNumber: 0,
  totalEmails: 0
};

// ATOMIC PROCESSING LOCK: Ensures only one email processes at a time
export function tryAcquireProcessingLock(initialStatus: Partial<ProcessingStatus>): boolean {
  if (currentProcessingStatus.isProcessing) {
    return false; // Lock already held
  }
  
  // Atomically acquire lock and set initial status
  currentProcessingStatus = { 
    ...currentProcessingStatus, 
    isProcessing: true,
    ...initialStatus 
  };
  
  console.log(`🔒 PROCESSING LOCK ACQUIRED: ${currentProcessingStatus.currentStep || 'Processing'} ${currentProcessingStatus.currentEmail ? `(${currentProcessingStatus.currentEmail})` : ''}`);
  return true; // Lock successfully acquired
}

// Release processing lock
export function releaseProcessingLock(finalStatus?: Partial<ProcessingStatus>) {
  currentProcessingStatus = {
    ...currentProcessingStatus,
    isProcessing: false,
    currentStep: finalStatus?.currentStep || "idle",
    currentEmail: finalStatus?.currentEmail || "System idle",
    emailNumber: 0,
    totalEmails: 0,
    ...finalStatus
  };
  console.log(`🔓 PROCESSING LOCK RELEASED: ${currentProcessingStatus.currentStep}`);
}

// Helper function to update processing status for real-time monitoring
export function updateProcessingStatus(update: Partial<ProcessingStatus>) {
  if (!currentProcessingStatus.isProcessing && update.isProcessing) {
    throw new Error("Cannot set isProcessing=true. Use tryAcquireProcessingLock() instead.");
  }
  
  currentProcessingStatus = { ...currentProcessingStatus, ...update };
  console.log(`📊 PROCESSING STATUS: ${currentProcessingStatus.currentStep || 'Idle'} ${currentProcessingStatus.currentEmail ? `(${currentProcessingStatus.currentEmail})` : ''}`);
}

// Get current processing status
export function getCurrentProcessingStatus(): ProcessingStatus {
  return { ...currentProcessingStatus };
}

// Set processing status for validator health checks (now unused - health checks don't show in UI)
export function setValidatorHealthStatus(validatorName: string, isRunning: boolean) {
  // Health checks no longer update the processing status UI
  // They run silently in the background without showing "processing" state
}