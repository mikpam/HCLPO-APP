import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

interface MemoryHealthData {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  arrayBuffersMB: number;
  timestamp: string;
  status: 'ok' | 'warning' | 'critical';
  recommendation: string;
}

export default function MemoryHealth() {
  const { data: memoryHealth, isLoading } = useQuery<MemoryHealthData>({
    queryKey: ["/api/memory/health"],
    refetchInterval: 5000 // Refresh every 5 seconds for real-time monitoring
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ok':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getUsageColor = (percentage: number) => {
    if (percentage > 80) return 'bg-red-500';
    if (percentage > 60) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const formatBytes = (mb: number) => {
    return `${mb.toFixed(1)} MB`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <i className="fas fa-memory text-blue-500"></i>
            <span>Memory Health</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-8 bg-gray-200 rounded"></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="h-16 bg-gray-200 rounded"></div>
              <div className="h-16 bg-gray-200 rounded"></div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!memoryHealth) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <i className="fas fa-memory text-blue-500"></i>
            <span>Memory Health</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">Memory health data unavailable</p>
        </CardContent>
      </Card>
    );
  }

  const heapUsagePercentage = (memoryHealth.heapUsedMB / memoryHealth.heapTotalMB) * 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <i className="fas fa-memory text-blue-500"></i>
            <span>Memory Health</span>
          </div>
          <Badge className={getStatusColor(memoryHealth.status)}>
            {memoryHealth.status.toUpperCase()}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Heap Usage Progress */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium">Heap Usage</span>
            <span className="text-gray-600">
              {formatBytes(memoryHealth.heapUsedMB)} / {formatBytes(memoryHealth.heapTotalMB)}
            </span>
          </div>
          <Progress 
            value={heapUsagePercentage} 
            className="h-3"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{heapUsagePercentage.toFixed(1)}% used</span>
            <span className="text-green-600">Optimized with LRU caches</span>
          </div>
        </div>

        {/* Memory Breakdown */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-xs text-gray-500 uppercase tracking-wide">RSS Memory</div>
            <div className="text-lg font-semibold text-gray-900">
              {formatBytes(memoryHealth.rssMB)}
            </div>
          </div>
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-xs text-gray-500 uppercase tracking-wide">External</div>
            <div className="text-lg font-semibold text-gray-900">
              {formatBytes(memoryHealth.externalMB)}
            </div>
          </div>
        </div>

        {/* Recommendation */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-start space-x-2">
            <i className="fas fa-lightbulb text-blue-500 mt-0.5"></i>
            <div>
              <div className="text-sm font-medium text-blue-900">Recommendation</div>
              <div className="text-sm text-blue-700">{memoryHealth.recommendation}</div>
            </div>
          </div>
        </div>

        {/* Memory Optimizations Badge */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">
              Last updated: {new Date(memoryHealth.timestamp).toLocaleTimeString()}
            </span>
            <Badge variant="outline" className="text-green-600 border-green-200">
              <i className="fas fa-check-circle mr-1"></i>
              Memory Optimized
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}