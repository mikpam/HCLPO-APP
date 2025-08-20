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

// Set processing status for validator health checks
export function setValidatorHealthStatus(validatorName: string, isRunning: boolean) {
  if (isRunning) {
    updateProcessingStatus({
      isProcessing: true,
      currentStep: "validator_health_check",
      currentEmail: `Running ${validatorName} health check...`,
      currentPO: "",
      emailNumber: 0,
      totalEmails: 0
    });
  } else {
    // Keep status visible for 5 seconds after health check completes
    setTimeout(() => {
      // Only reset if we're still in health check mode
      if (currentProcessingStatus.currentStep === "validator_health_check") {
        updateProcessingStatus({
          isProcessing: false,
          currentStep: "idle",
          currentEmail: "",
          currentPO: "",
          emailNumber: 0,
          totalEmails: 0
        });
      }
    }, 5000);
  }
}