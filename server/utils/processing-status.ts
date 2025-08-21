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

// Helper function to update processing status for real-time monitoring
export function updateProcessingStatus(update: Partial<ProcessingStatus>) {
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

// 🔒 CRITICAL: Sequential Processing Lock - ONLY ONE EMAIL AT A TIME
export function tryAcquireProcessingLock(): boolean {
  if (currentProcessingStatus.isProcessing) {
    console.log(`🚫 PROCESSING LOCK: Already processing - cannot start concurrent processing`);
    return false; // Lock already held
  }
  
  // Atomically acquire the lock
  currentProcessingStatus.isProcessing = true;
  console.log(`🔒 PROCESSING LOCK: Acquired successfully - sequential processing enforced`);
  return true; // Lock acquired
}

// Release the processing lock
export function releaseProcessingLock() {
  currentProcessingStatus.isProcessing = false;
  currentProcessingStatus.currentStep = "idle";
  currentProcessingStatus.currentEmail = "";
  currentProcessingStatus.currentPO = "";
  currentProcessingStatus.emailNumber = 0;
  currentProcessingStatus.totalEmails = 0;
  console.log(`🔓 PROCESSING LOCK: Released - system ready for next email`);
}