import { useQuery } from "@tanstack/react-query";
import { SystemHealthItem, ProcessingQueueStatus } from "@/types";
import { Button } from "@/components/ui/button";

export default function SystemHealth() {
  const { data: systemHealth, isLoading: healthLoading } = useQuery<SystemHealthItem[]>({
    queryKey: ["/api/system/health"],
    refetchInterval: 600000 // Refresh every 10 minutes
  });

  const { data: queueStatus, isLoading: queueLoading } = useQuery<ProcessingQueueStatus>({
    queryKey: ["/api/processing/queue-status"],
    refetchInterval: 600000 // Refresh every 10 minutes
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'bg-success';
      case 'delayed':
        return 'bg-warning';
      case 'offline':
        return 'bg-error';
      default:
        return 'bg-gray-400';
    }
  };

  const handleProcessQueue = async () => {
    try {
      const response = await fetch('/api/processing/process-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to process queue');
      }
      
      // You could add a toast notification here
      console.log('Queue processing started');
    } catch (error) {
      console.error('Error processing queue:', error);
    }
  };

  const handleManualProcess = () => {
    // This will be handled by the modal
    const modal = document.getElementById('manualProcessModal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  };

  return (
    <div className="space-y-6">
      {/* System Health */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">System Health</h3>
        
        {healthLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-gray-200 rounded-full"></div>
                  <div className="w-20 h-4 bg-gray-200 rounded"></div>
                </div>
                <div className="w-12 h-4 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {systemHealth?.map((service) => (
              <div key={service.id} className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 ${getStatusColor(service.status)} rounded-full`}></div>
                  <span className="text-sm text-slate-800">{service.service}</span>
                </div>
                <span className="text-xs text-secondary">
                  {service.status === 'online' ? 'Online' : 
                   service.status === 'delayed' ? 'Delayed' : 'Offline'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Processing Queue */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Processing Queue</h3>
        
        {queueLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="w-32 h-4 bg-gray-200 rounded"></div>
                <div className="w-8 h-4 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-secondary">Awaiting Classification</span>
              <span className="font-medium text-slate-800">{queueStatus?.classification || 0}</span>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-secondary">Ready for NS Import</span>
              <span className="font-medium text-slate-800">{queueStatus?.import || 0}</span>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-secondary">Pending Review</span>
              <span className="font-medium text-slate-800">{queueStatus?.review || 0}</span>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-secondary">Processing Errors</span>
              <span className="font-medium text-error">{queueStatus?.errors || 0}</span>
            </div>
          </div>
        )}
        
        <Button 
          onClick={handleProcessQueue}
          className="w-full mt-4"
          variant="outline"
        >
          Process Next Batch
        </Button>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Quick Actions</h3>
        
        <div className="space-y-3">
          <Button 
            onClick={handleManualProcess}
            className="w-full"
          >
            <i className="fas fa-plus mr-2"></i>
            Manual Process Email
          </Button>
          
          <Button 
            variant="outline"
            className="w-full"
            onClick={() => window.location.href = '/error-logs'}
          >
            <i className="fas fa-exclamation-triangle mr-2"></i>
            Review Errors
          </Button>
          
          <Button 
            variant="outline"
            className="w-full"
          >
            <i className="fas fa-download mr-2"></i>
            Export Data
          </Button>
        </div>
      </div>
    </div>
  );
}
