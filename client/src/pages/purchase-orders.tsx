import { useQuery } from "@tanstack/react-query";
import { PurchaseOrder } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function PurchaseOrdersPage() {
  const { data: purchaseOrders, isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders"],
    refetchInterval: 30000
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processed':
      case 'imported':
        return 'bg-green-100 text-success';
      case 'ready for NS import':
        return 'bg-blue-100 text-primary';
      case 'pending_review':
        return 'bg-amber-100 text-warning';
      case 'error':
        return 'bg-red-100 text-error';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const handleImportToNetSuite = async (orderId: string) => {
    try {
      const response = await fetch(`/api/purchase-orders/${orderId}/import-netsuite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to import to NetSuite');
      }
      
      // Refetch data
      window.location.reload();
    } catch (error) {
      console.error('Error importing to NetSuite:', error);
    }
  };

  return (
    <div>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Purchase Orders</h1>
            <p className="text-secondary mt-1">Manage and track purchase order processing</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline">
              <i className="fas fa-filter mr-2"></i>
              Filter
            </Button>
            <Button>
              <i className="fas fa-plus mr-2"></i>
              Manual Entry
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">PO Number</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Sender</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Route</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Confidence</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><div className="w-24 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-32 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-20 h-6 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-16 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-12 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-24 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-20 h-8 bg-gray-200 rounded animate-pulse"></div></td>
                    </tr>
                  ))
                ) : purchaseOrders && purchaseOrders.length > 0 ? (
                  purchaseOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-slate-800">{order.poNumber}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-slate-800">{order.sender}</p>
                        <p className="text-xs text-secondary truncate max-w-xs">{order.subject}</p>
                      </td>
                      <td className="px-6 py-4">
                        <Badge className={getStatusBadge(order.status)}>
                          {order.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-800">
                        {order.route || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-800">
                        {order.confidence ? `${Math.round(order.confidence * 100)}%` : 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-secondary">
                        {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4">
                        {order.status === 'ready for NS import' ? (
                          <Button 
                            size="sm"
                            onClick={() => handleImportToNetSuite(order.id)}
                          >
                            Import
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm">
                            View
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      No purchase orders found
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
