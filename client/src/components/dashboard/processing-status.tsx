import { useQuery } from "@tanstack/react-query";

interface ProcessingStatus {
  isProcessing: boolean;
  currentStep: string;
  currentPO: string;
  currentEmail: string;
  emailNumber: number;
  totalEmails: number;
}

export default function ProcessingStatus() {
  const { data: status } = useQuery<ProcessingStatus>({
    queryKey: ["/api/processing/current-status"],
    refetchInterval: 1000, // Update every second
  });

  const getStepDisplayName = (step: string) => {
    switch (step) {
      case "email_preprocessing":
        return "Analyzing Email";
      case "po_assignment":
        return "Assigning PO Number";
      case "gemini_extraction":
        return "Extracting Data";
      case "customer_validation":
        return "Validating Customer";
      case "line_item_validation":
        return "Validating Items";
      case "completed":
        return "Completed";
      default:
        return step;
    }
  };

  const getStepIcon = (step: string) => {
    switch (step) {
      case "email_preprocessing":
        return "fas fa-envelope-open-text";
      case "po_assignment":
        return "fas fa-file-invoice";
      case "gemini_extraction":
        return "fas fa-magic";
      case "customer_validation":
        return "fas fa-user-check";
      case "line_item_validation":
        return "fas fa-tasks";
      case "completed":
        return "fas fa-check-circle";
      default:
        return "fas fa-cog fa-spin";
    }
  };

  const getStepColor = (step: string) => {
    switch (step) {
      case "email_preprocessing":
        return "text-blue-500";
      case "po_assignment":
        return "text-purple-500";
      case "gemini_extraction":
        return "text-orange-500";
      case "customer_validation":
        return "text-green-500";
      case "line_item_validation":
        return "text-indigo-500";
      case "completed":
        return "text-emerald-500";
      default:
        return "text-gray-500";
    }
  };

  if (!status || !status.isProcessing) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Processing Status</h3>
            <p className="text-sm text-gray-500">System is idle - no emails being processed</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
          <h3 className="text-lg font-semibold text-slate-800">Processing Status</h3>
        </div>
        <div className="text-sm text-gray-500">
          Email {status.emailNumber}/{status.totalEmails}
        </div>
      </div>

      {/* Current PO */}
      {status.currentPO && (
        <div className="mb-3">
          <div className="text-sm text-gray-500 mb-1">Current Purchase Order</div>
          <div className="text-lg font-mono font-semibold text-slate-800">
            {status.currentPO}
          </div>
        </div>
      )}

      {/* Current Step */}
      <div className="mb-4">
        <div className="flex items-center space-x-3">
          <i 
            className={`${getStepIcon(status.currentStep)} ${getStepColor(status.currentStep)} text-xl`}
            aria-hidden="true"
          ></i>
          <div>
            <div className="text-sm text-gray-500">Current Step</div>
            <div className="font-semibold text-slate-800">
              {getStepDisplayName(status.currentStep)}
            </div>
          </div>
        </div>
      </div>



      {/* Current Email */}
      {status.currentEmail && (
        <div className="text-sm text-gray-600 truncate">
          <span className="text-gray-500">Email:</span> {status.currentEmail}
        </div>
      )}
    </div>
  );
}