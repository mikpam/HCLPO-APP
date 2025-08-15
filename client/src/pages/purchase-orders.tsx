import { useQuery } from "@tanstack/react-query";
import { PurchaseOrder } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import { Eye, ExternalLink, FileText } from "lucide-react";

export default function PurchaseOrdersPage() {
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  
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

  const handleViewOrder = (order: PurchaseOrder) => {
    setSelectedOrder(order);
    setIsViewModalOpen(true);
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
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleViewOrder(order)}
                          >
                            <Eye className="h-4 w-4 mr-2" />
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

      {/* View Order Modal */}
      <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Purchase Order Details - {selectedOrder?.poNumber}
            </DialogTitle>
            <DialogDescription>
              Complete details and processing information for this purchase order
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Basic Information */}
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm text-gray-700 mb-2">Basic Information</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">PO Number:</span>
                      <span className="font-medium">{selectedOrder.poNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Status:</span>
                      <Badge className={getStatusBadge(selectedOrder.status)}>
                        {selectedOrder.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Route:</span>
                      <span className="font-medium">{selectedOrder.route || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Confidence:</span>
                      <span className="font-medium">
                        {selectedOrder.confidence ? `${Math.round(selectedOrder.confidence * 100)}%` : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Created:</span>
                      <span className="font-medium">
                        {selectedOrder.createdAt ? new Date(selectedOrder.createdAt).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Email Information */}
                <div>
                  <h3 className="font-semibold text-sm text-gray-700 mb-2">Email Information</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-600">From:</span>
                      <div className="font-medium">{selectedOrder.sender}</div>
                    </div>
                    <div>
                      <span className="text-gray-600">Subject:</span>
                      <div className="font-medium">{selectedOrder.subject}</div>
                    </div>
                    <div>
                      <span className="text-gray-600">Email ID:</span>
                      <div className="font-mono text-xs bg-gray-100 p-1 rounded">
                        {selectedOrder.emailId}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Processing Results */}
              <div className="space-y-4">
                {selectedOrder.classificationResult && (
                  <div>
                    <h3 className="font-semibold text-sm text-gray-700 mb-2">AI Classification</h3>
                    <div className="bg-gray-50 p-3 rounded-lg space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Recommended Route:</span>
                        <span className="font-medium">{selectedOrder.classificationResult.recommended_route}</span>
                      </div>
                      {selectedOrder.classificationResult.analysis_flags && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Has Attachments:</span>
                            <span className="font-medium">
                              {selectedOrder.classificationResult.analysis_flags.has_attachments ? 'Yes' : 'No'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Confidence Score:</span>
                            <span className="font-medium">
                              {selectedOrder.classificationResult.analysis_flags.confidence_score ? 
                                `${Math.round(selectedOrder.classificationResult.analysis_flags.confidence_score * 100)}%` : 
                                'N/A'
                              }
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Gemini Extracted Data */}
                {selectedOrder.extractedData && (
                  <div>
                    <h3 className="font-semibold text-sm text-gray-700 mb-2">Extracted PO Data</h3>
                    <div className="bg-blue-50 p-3 rounded-lg space-y-3 text-sm">
                      {selectedOrder.extractedData.purchaseOrder && (
                        <>
                          <div className="space-y-2">
                            <h4 className="font-medium text-blue-800">Purchase Order Details</h4>
                            {selectedOrder.extractedData.purchaseOrder.purchaseOrderNumber && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">PO Number:</span>
                                <span className="font-medium">{selectedOrder.extractedData.purchaseOrder.purchaseOrderNumber}</span>
                              </div>
                            )}
                            {selectedOrder.extractedData.purchaseOrder.orderDate && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">Order Date:</span>
                                <span className="font-medium">{selectedOrder.extractedData.purchaseOrder.orderDate}</span>
                              </div>
                            )}
                            {selectedOrder.extractedData.purchaseOrder.customer?.company && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">Customer:</span>
                                <span className="font-medium">{selectedOrder.extractedData.purchaseOrder.customer.company}</span>
                              </div>
                            )}
                            {selectedOrder.extractedData.purchaseOrder.shippingMethod && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">Shipping:</span>
                                <span className="font-medium">{selectedOrder.extractedData.purchaseOrder.shippingMethod}</span>
                              </div>
                            )}
                          </div>
                          
                          {selectedOrder.extractedData.lineItems && selectedOrder.extractedData.lineItems.length > 0 && (
                            <div className="space-y-2 border-t border-blue-200 pt-3">
                              <h4 className="font-medium text-blue-800">Line Items ({selectedOrder.extractedData.lineItems.length})</h4>
                              {selectedOrder.extractedData.lineItems.slice(0, 3).map((item: any, index: number) => (
                                <div key={index} className="bg-white p-2 rounded border">
                                  <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                      <div className="font-medium text-xs">{item.description || item.sku || 'Unknown Item'}</div>
                                      {item.sku && <div className="text-gray-500 text-xs">SKU: {item.sku}</div>}
                                    </div>
                                    <div className="text-right ml-2">
                                      {item.quantity && <div className="font-medium text-xs">Qty: {item.quantity}</div>}
                                      {item.unitPrice && <div className="text-gray-600 text-xs">${item.unitPrice}</div>}
                                    </div>
                                  </div>
                                </div>
                              ))}
                              {selectedOrder.extractedData.lineItems.length > 3 && (
                                <div className="text-center text-xs text-gray-500">
                                  ... and {selectedOrder.extractedData.lineItems.length - 3} more items
                                </div>
                              )}
                            </div>
                          )}
                          
                          {selectedOrder.extractedData.subtotals?.grandTotal && (
                            <div className="border-t border-blue-200 pt-2">
                              <div className="flex justify-between font-medium">
                                <span className="text-gray-600">Grand Total:</span>
                                <span className="text-blue-800">${selectedOrder.extractedData.subtotals.grandTotal}</span>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      
                      <div className="text-xs text-blue-600 border-t border-blue-200 pt-2">
                        Extracted by: {selectedOrder.extractedData.engine || 'Gemini'} AI
                      </div>
                    </div>
                  </div>
                )}

                {/* NetSuite Information */}
                {selectedOrder.netsuiteResult && (
                  <div>
                    <h3 className="font-semibold text-sm text-gray-700 mb-2">NetSuite Integration</h3>
                    <div className="bg-gray-50 p-3 rounded-lg space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Status:</span>
                        <span className="font-medium">{selectedOrder.netsuiteResult.status}</span>
                      </div>
                      {selectedOrder.netsuiteResult.salesOrderId && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Sales Order ID:</span>
                          <span className="font-medium">{selectedOrder.netsuiteResult.salesOrderId}</span>
                        </div>
                      )}
                      {selectedOrder.netsuiteResult.error && (
                        <div>
                          <span className="text-gray-600">Error:</span>
                          <div className="text-red-600 text-xs mt-1">{selectedOrder.netsuiteResult.error}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="pt-4">
                  <div className="flex gap-2">
                    {selectedOrder.status === 'ready for NS import' && (
                      <Button 
                        size="sm"
                        onClick={() => handleImportToNetSuite(selectedOrder.id)}
                      >
                        Import to NetSuite
                      </Button>
                    )}
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.open(`/api/purchase-orders/${selectedOrder.id}/export`, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Export Data
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
