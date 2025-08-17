import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardMetrics } from "@/types";
import MetricsCards from "@/components/dashboard/metrics-cards";
import RecentProcessing from "@/components/dashboard/recent-processing";
import SystemHealth from "@/components/dashboard/system-health";
import ManualProcessModal from "@/components/modals/manual-process-modal";
import EmailProcessingAnimation from "@/components/dashboard/email-processing-animation";
import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lastProcessResult, setLastProcessResult] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: metrics, isLoading: metricsLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
    refetchInterval: 5000 // Refresh every 5 seconds to show live processing updates
  });

  const processSingleEmail = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/emails/process-single", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    },
    onSuccess: (result) => {
      setLastProcessResult(result);
      toast({
        title: "Email Processed",
        description: result.message,
        duration: 5000,
      });
      
      // Refresh dashboard metrics, email queue, and purchase orders
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
    },
    onError: (error: any) => {
      console.error("Processing error:", error);
      toast({
        title: "Processing Failed",
        description: error.message || "Failed to process email",
        variant: "destructive",
      });
    },
  });



  // Real-time processing state
  const [processingState, setProcessingState] = useState({
    isProcessing: false,
    currentEmail: null as { sender?: string; subject?: string; number?: number } | null,
    processedCount: 0,
    totalCount: 0,
    currentStep: ""
  });

  // Background processing status (for animation)
  const { data: backgroundStatus } = useQuery({
    queryKey: ["/api/processing/current-status"],
    refetchInterval: 3000, // Check every 3 seconds
    onSuccess: (data) => {
      if (data) {
        setProcessingState({
          isProcessing: data.isProcessing || false,
          currentEmail: data.currentEmail || null,
          processedCount: data.processedCount || 0,
          totalCount: data.totalCount || 0,
          currentStep: data.currentStep || ""
        });
      }
    }
  });

  // SSE-based real-time processing
  const startRealTimeProcessing = () => {
    if (processingState.isProcessing) return;

    setProcessingState(prev => ({ ...prev, isProcessing: true, currentStep: "Connecting..." }));

    const eventSource = new EventSource("/api/emails/process/stream");

    eventSource.onopen = () => {
      console.log("SSE connection opened");
      setProcessingState(prev => ({ ...prev, currentStep: "Connected - Starting processing..." }));
    };

    eventSource.addEventListener("progress", (event) => {
      const data = JSON.parse(event.data);
      console.log("SSE Progress:", data);

      switch (data.type) {
        case "started":
          setProcessingState(prev => ({
            ...prev,
            totalCount: data.totalUnprocessed,
            currentStep: data.message
          }));
          break;

        case "processing_email":
          setProcessingState(prev => ({
            ...prev,
            currentEmail: data.currentEmail,
            processedCount: data.processedCount,
            currentStep: `Processing: ${data.currentEmail.subject}`
          }));
          break;

        case "email_completed":
          setProcessingState(prev => ({
            ...prev,
            processedCount: data.processedCount,
            currentStep: `Completed: ${data.currentEmail.subject}`
          }));
          // Reset current email after a short delay
          setTimeout(() => {
            setProcessingState(prev => ({ ...prev, currentEmail: null }));
          }, 1000);
          break;

        case "completed":
          setProcessingState(prev => ({
            ...prev,
            isProcessing: false,
            currentStep: data.message,
            currentEmail: null
          }));
          toast({
            title: "Real-time Processing Complete",
            description: `Processed ${data.processedCount} emails`,
            duration: 8000,
          });
          // Refresh data
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
          queryClient.invalidateQueries({ queryKey: ["/api/email-queue"] });
          queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
          break;

        case "no_more_emails":
          setProcessingState(prev => ({
            ...prev,
            isProcessing: false,
            currentStep: "No more emails to process",
            currentEmail: null
          }));
          break;
      }
    });

    eventSource.addEventListener("error", (event) => {
      const data = JSON.parse((event as any).data);
      console.error("SSE Error:", data);
      toast({
        title: "Processing Error",
        description: data.message || "Processing failed",
        variant: "destructive",
      });
      setProcessingState(prev => ({ ...prev, isProcessing: false, currentEmail: null }));
      eventSource.close();
    });

    eventSource.addEventListener("close", (event) => {
      console.log("SSE closed:", event);
      eventSource.close();
      setProcessingState(prev => ({ ...prev, isProcessing: false, currentEmail: null }));
    });

    eventSource.onerror = (error) => {
      console.error("SSE connection error:", error);
      eventSource.close();
      setProcessingState(prev => ({ ...prev, isProcessing: false, currentEmail: null }));
      toast({
        title: "Connection Error",
        description: "Lost connection to processing stream",
        variant: "destructive",
      });
    };
  };

  const processNormalEmails = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/emails/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    },
    onSuccess: (result) => {
      setLastProcessResult(result);
      toast({
        title: "Normal Processing Complete",
        description: `Processed ${result.processed} emails. ${result.remaining ? `${result.remaining} emails remaining.` : 'All emails processed!'}`,
        duration: 8000,
      });
      
      // Refresh dashboard metrics, email queue, and purchase orders
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
    },
    onError: (error: any) => {
      console.error("Normal processing error:", error);
      toast({
        title: "Normal Processing Failed",
        description: error.message || "Failed to process emails",
        variant: "destructive",
      });
    },
  });

  // Handle modal opening from global events (for backward compatibility with existing buttons)
  useEffect(() => {
    const handleGlobalModalOpen = (event: CustomEvent) => {
      if (event.detail === 'manual-process') {
        setIsModalOpen(true);
      }
    };

    // Add event listener for custom events
    document.addEventListener('openModal', handleGlobalModalOpen as EventListener);

    // Handle direct DOM manipulation for backward compatibility
    const originalModal = document.getElementById('manualProcessModal');
    if (originalModal) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const element = mutation.target as HTMLElement;
            if (!element.classList.contains('hidden')) {
              setIsModalOpen(true);
            }
          }
        });
      });
      
      observer.observe(originalModal, { 
        attributes: true, 
        attributeFilter: ['class'] 
      });

      return () => {
        observer.disconnect();
        document.removeEventListener('openModal', handleGlobalModalOpen as EventListener);
      };
    }

    return () => {
      document.removeEventListener('openModal', handleGlobalModalOpen as EventListener);
    };
  }, []);

  return (
    <div>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Dashboard Overview</h1>
            <p className="text-secondary mt-1">Monitor and manage purchase order processing</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm text-secondary">
              <i className="fas fa-sync-alt w-4"></i>
              <span>Last sync: 2 minutes ago</span>
            </div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              <i className="fas fa-plus mr-2"></i>
              Manual Process
            </button>
          </div>
        </div>
      </header>

      <div className="p-8">
        {/* Metrics Cards */}
        <MetricsCards 
          metrics={metrics || { emailsProcessedToday: 0, posProcessed: 0, pendingReview: 0, processingErrors: 0 }}
          isLoading={metricsLoading}
        />

        {/* Email Processing Animation */}
        <EmailProcessingAnimation 
          isProcessing={processSingleEmail.isPending || processNormalEmails.isPending || processingState.isProcessing}
          processedCount={processingState.processedCount || lastProcessResult?.processed || 0}
          totalCount={processingState.totalCount || lastProcessResult?.total || 0}
          currentStep={processingState.currentStep || 
                      (processSingleEmail.isPending ? "Processing single email..." : 
                      processNormalEmails.isPending ? "Processing emails normally..." : "")}
          currentEmail={processingState.currentEmail}
          finalStatus={lastProcessResult?.details?.purchaseOrder?.status || "pending"}
          onAnimationComplete={() => {
            console.log("Animation completed with status:", lastProcessResult?.details?.purchaseOrder?.status);
          }}
        />

        {/* Processing Result Display */}
        {lastProcessResult && (
          <div className="mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-blue-800 mb-4">
              <i className="fas fa-check-circle text-blue-600 mr-2"></i>
              Processing Result
            </h3>
            
            {lastProcessResult.details ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-gray-800 mb-2">Email Details</h4>
                  <div className="space-y-2 text-sm">
                    <div><strong>From:</strong> {lastProcessResult.details.sender}</div>
                    <div><strong>Subject:</strong> {lastProcessResult.details.subject}</div>
                    <div><strong>Email ID:</strong> <code className="text-xs bg-gray-100 px-1 rounded">{lastProcessResult.details.emailId}</code></div>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium text-gray-800 mb-2">Processing Steps</h4>
                  <div className="space-y-3">
                    <div className="bg-white rounded p-3 border">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-blue-800">Step 1: Pre-processing</span>
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          {lastProcessResult.details.preprocessing.confidence}% confidence
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">
                        Classification: <strong>{lastProcessResult.details.preprocessing.classification}</strong>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Should proceed: {lastProcessResult.details.preprocessing.shouldProceed ? '✅ Yes' : '❌ No'}
                      </div>
                    </div>
                    
                    {lastProcessResult.details.classification && (
                      <div className="bg-white rounded p-3 border">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-green-800">Step 2: Detailed Analysis</span>
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                            {lastProcessResult.details.classification.confidence}% confidence
                          </span>
                        </div>
                        <div className="text-sm text-gray-600">
                          Route: <strong>{lastProcessResult.details.classification.route}</strong>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Has attachments: {lastProcessResult.details.classification.hasAttachments ? '📎 Yes' : '📄 Text only'} • 
                          Requires review: {lastProcessResult.details.classification.requiresReview ? '👀 Yes' : '✅ Auto-process'}
                        </div>
                      </div>
                    )}
                    
                    {lastProcessResult.details.purchaseOrder && (
                      <div className="bg-white rounded p-3 border">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-purple-800">Purchase Order Created</span>
                          <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                            {lastProcessResult.details.purchaseOrder.status}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600">
                          PO Number: <strong>{lastProcessResult.details.purchaseOrder.poNumber}</strong>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-gray-600">
                {lastProcessResult.message}
              </div>
            )}
            
            <button 
              onClick={() => setLastProcessResult(null)}
              className="mt-4 text-xs text-amber-700 hover:text-amber-800 underline"
            >
              Dismiss Result
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Email Processing */}
          <RecentProcessing />

          {/* System Status Panel */}
          <SystemHealth />
        </div>

        {/* Error Logs Section - This will be moved to its own page */}
        <div className="mt-8 bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Recent Error Logs</h2>
              <div className="flex items-center space-x-2">
                <button className="px-3 py-1 text-sm text-secondary border border-gray-300 rounded-md hover:bg-gray-50">
                  <i className="fas fa-filter mr-1"></i>
                  Filter
                </button>
                <button className="px-3 py-1 text-sm text-primary border border-primary rounded-md hover:bg-blue-50">
                  <i className="fas fa-sync mr-1"></i>
                  Refresh
                </button>
              </div>
            </div>
          </div>
          
          <div className="p-6 text-center text-gray-500">
            <p>Error logs will be displayed here. Visit the Error Logs page for detailed management.</p>
          </div>
        </div>
      </div>

      {/* Manual Process Modal */}
      <ManualProcessModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
