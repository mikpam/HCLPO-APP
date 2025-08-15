import { useQuery } from "@tanstack/react-query";
import { DashboardMetrics } from "@/types";
import MetricsCards from "@/components/dashboard/metrics-cards";
import RecentProcessing from "@/components/dashboard/recent-processing";
import SystemHealth from "@/components/dashboard/system-health";
import ManualProcessModal from "@/components/modals/manual-process-modal";
import { useState, useEffect } from "react";

export default function Dashboard() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const { data: metrics, isLoading: metricsLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
    refetchInterval: 30000 // Refresh every 30 seconds
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
