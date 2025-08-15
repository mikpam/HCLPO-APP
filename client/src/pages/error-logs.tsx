import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorLog } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export default function ErrorLogsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: errorLogs, isLoading } = useQuery<ErrorLog[]>({
    queryKey: ["/api/error-logs"],
    refetchInterval: 30000
  });

  const handleResolveError = async (errorId: string) => {
    try {
      const response = await fetch(`/api/error-logs/${errorId}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolvedBy: 'current-user' })
      });
      
      if (!response.ok) {
        throw new Error('Failed to resolve error');
      }
      
      toast({
        title: "Success",
        description: "Error has been resolved"
      });
      
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ["/api/error-logs"] });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to resolve error",
        variant: "destructive"
      });
    }
  };

  const getErrorTypeBadge = (type: string) => {
    switch (type.toLowerCase()) {
      case 'classification error':
        return 'bg-red-100 text-error';
      case 'netsuite import':
        return 'bg-orange-100 text-orange-600';
      case 'processing error':
        return 'bg-amber-100 text-warning';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Error Logs</h1>
            <p className="text-secondary mt-1">Monitor and resolve processing errors</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline">
              <i className="fas fa-filter mr-2"></i>
              Filter
            </Button>
            <Button variant="outline">
              <i className="fas fa-sync mr-2"></i>
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="p-8">
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Error Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Message</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Related PO</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><div className="w-24 h-6 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-48 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-16 h-6 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-24 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-16 h-8 bg-gray-200 rounded animate-pulse"></div></td>
                    </tr>
                  ))
                ) : errorLogs && errorLogs.length > 0 ? (
                  errorLogs.map((error) => (
                    <tr key={error.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <Badge className={getErrorTypeBadge(error.type)}>
                          {error.type}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-slate-800 max-w-md truncate">{error.message}</p>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-800">
                        {error.relatedPoNumber || 'N/A'}
                      </td>
                      <td className="px-6 py-4">
                        <Badge className={error.resolved ? 'bg-green-100 text-success' : 'bg-amber-100 text-warning'}>
                          {error.resolved ? 'Resolved' : 'Pending'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-secondary">
                        {error.createdAt ? new Date(error.createdAt).toLocaleString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4">
                        {!error.resolved ? (
                          <Button 
                            size="sm"
                            onClick={() => handleResolveError(error.id)}
                          >
                            Resolve
                          </Button>
                        ) : (
                          <span className="text-secondary text-sm">Completed</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                      No error logs found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
