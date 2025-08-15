import { useQuery } from "@tanstack/react-query";
import { SystemHealthItem, ProcessingQueueStatus } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export default function SystemStatusPage() {
  const { data: systemHealth, isLoading: healthLoading } = useQuery<SystemHealthItem[]>({
    queryKey: ["/api/system/health"],
    refetchInterval: 10000 // Refresh every 10 seconds
  });

  const { data: queueStatus, isLoading: queueLoading } = useQuery<ProcessingQueueStatus>({
    queryKey: ["/api/processing/queue-status"],
    refetchInterval: 10000
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'bg-success text-white';
      case 'delayed':
        return 'bg-warning text-white';
      case 'offline':
        return 'bg-error text-white';
      default:
        return 'bg-gray-400 text-white';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
        return 'fas fa-check-circle';
      case 'delayed':
        return 'fas fa-clock';
      case 'offline':
        return 'fas fa-times-circle';
      default:
        return 'fas fa-question-circle';
    }
  };

  const getResponseTimeColor = (responseTime: number) => {
    if (responseTime < 100) return 'text-success';
    if (responseTime < 500) return 'text-warning';
    return 'text-error';
  };

  const handleRefreshStatus = () => {
    window.location.reload();
  };

  const handleProcessQueue = async () => {
    try {
      const response = await fetch('/api/processing/process-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to process queue');
      }
      
      console.log('Queue processing started');
    } catch (error) {
      console.error('Error processing queue:', error);
    }
  };

  return (
    <div>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">System Status</h1>
            <p className="text-secondary mt-1">Monitor system health and service status</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" onClick={handleRefreshStatus}>
              <i className="fas fa-sync mr-2"></i>
              Refresh Status
            </Button>
            <Button onClick={handleProcessQueue}>
              <i className="fas fa-play mr-2"></i>
              Process Queue
            </Button>
          </div>
        </div>
      </header>

      <div className="p-8 space-y-8">
        {/* Service Health Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <i className="fas fa-heartbeat text-primary"></i>
                <span>Service Health</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {healthLoading ? (
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between p-4 rounded-lg border animate-pulse">
                      <div className="flex items-center space-x-3">
                        <div className="w-3 h-3 bg-gray-200 rounded-full"></div>
                        <div className="w-24 h-4 bg-gray-200 rounded"></div>
                      </div>
                      <div className="text-right">
                        <div className="w-16 h-4 bg-gray-200 rounded mb-1"></div>
                        <div className="w-12 h-3 bg-gray-200 rounded"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {systemHealth?.map((service) => (
                    <div key={service.id} className="flex items-center justify-between p-4 rounded-lg border hover:bg-gray-50">
                      <div className="flex items-center space-x-3">
                        <div className={`w-3 h-3 rounded-full ${getStatusColor(service.status).split(' ')[0]}`}></div>
                        <div>
                          <p className="font-medium text-slate-800">{service.service}</p>
                          <div className="flex items-center space-x-2 text-xs text-secondary">
                            <i className={getStatusIcon(service.status)}></i>
                            <span>Last check: {new Date(service.lastCheck).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge className={getStatusColor(service.status)}>
                          {service.status.charAt(0).toUpperCase() + service.status.slice(1)}
                        </Badge>
                        {service.responseTime && (
                          <p className={`text-xs mt-1 ${getResponseTimeColor(service.responseTime)}`}>
                            {service.responseTime}ms
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <i className="fas fa-list text-primary"></i>
                <span>Processing Queue</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {queueLoading ? (
                <div className="space-y-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 animate-pulse">
                      <div className="w-32 h-4 bg-gray-200 rounded"></div>
                      <div className="w-8 h-6 bg-gray-200 rounded"></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50">
                    <span className="text-sm font-medium text-slate-800">Awaiting Classification</span>
                    <Badge className="bg-primary text-white">{queueStatus?.classification || 0}</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 rounded-lg bg-green-50">
                    <span className="text-sm font-medium text-slate-800">Ready for NS Import</span>
                    <Badge className="bg-success text-white">{queueStatus?.import || 0}</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50">
                    <span className="text-sm font-medium text-slate-800">Pending Review</span>
                    <Badge className="bg-warning text-white">{queueStatus?.review || 0}</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 rounded-lg bg-red-50">
                    <span className="text-sm font-medium text-slate-800">Processing Errors</span>
                    <Badge className="bg-error text-white">{queueStatus?.errors || 0}</Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detailed Service Information */}
        <Card>
          <CardHeader>
            <CardTitle>Service Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Service</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Response Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Last Check</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Health</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {healthLoading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i}>
                        <td className="px-6 py-4"><div className="w-24 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                        <td className="px-6 py-4"><div className="w-16 h-6 bg-gray-200 rounded animate-pulse"></div></td>
                        <td className="px-6 py-4"><div className="w-12 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                        <td className="px-6 py-4"><div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                        <td className="px-6 py-4"><div className="w-16 h-2 bg-gray-200 rounded animate-pulse"></div></td>
                      </tr>
                    ))
                  ) : (
                    systemHealth?.map((service) => (
                      <tr key={service.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-2">
                            <i className="fas fa-server text-gray-400"></i>
                            <span className="font-medium text-slate-800">{service.service}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <Badge className={getStatusColor(service.status)}>
                            {service.status.charAt(0).toUpperCase() + service.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-sm font-mono ${service.responseTime ? getResponseTimeColor(service.responseTime) : 'text-gray-400'}`}>
                            {service.responseTime ? `${service.responseTime}ms` : 'N/A'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-secondary">
                          {new Date(service.lastCheck).toLocaleString()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="w-20">
                            <Progress 
                              value={service.status === 'online' ? 100 : service.status === 'delayed' ? 60 : 0}
                              className="h-2"
                            />
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
