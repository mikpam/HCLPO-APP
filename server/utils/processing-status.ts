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