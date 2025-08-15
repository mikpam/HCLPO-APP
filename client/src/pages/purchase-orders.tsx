import { useQuery } from "@tanstack/react-query";
import { PurchaseOrder } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useMemo } from "react";
import { Eye, ExternalLink, FileText, Search, Filter, ArrowUpDown, MoreHorizontal, MapPin, Calendar, User, Mail, Hash, CheckCircle, XCircle, Clock } from "lucide-react";

export default function PurchaseOrdersPage() {
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [routeFilter, setRouteFilter] = useState("all");
  const [sortField, setSortField] = useState("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  
  const { data: purchaseOrders, isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders"],
    refetchInterval: 30000
  });

  // Customer info extraction function
  const getCustomerInfo = (order: PurchaseOrder) => {
    const extractedData = order.extractedData as any;
    
    // Try multiple possible locations for customer data in Gemini JSON
    const customer = extractedData?.purchaseOrder?.customer || extractedData?.customer || {};
    const shipTo = extractedData?.purchaseOrder?.shipTo || {};
    
    // Customer name: try company first, then firstName/lastName, then shipTo company
    const customerName = customer.company || 
                        (customer.firstName && customer.lastName ? `${customer.firstName} ${customer.lastName}` : '') ||
                        customer.customerName ||
                        shipTo.company ||
                        (shipTo.firstName && shipTo.lastName ? `${shipTo.firstName} ${shipTo.lastName}` : '') ||
                        'Unknown Customer';
    
    // Email: try customer email first, then fallback to sender
    const email = customer.email || order.sender || 'No email';
    
    // Address: try customer address first, then shipTo address
    const address = customer.address1 || shipTo.address1 || 'No address';
    const city = customer.city || shipTo.city || '';
    const state = customer.state || shipTo.state || '';
    const fullAddress = address + (city && state ? `, ${city}, ${state}` : city ? `, ${city}` : state ? `, ${state}` : '');
    
    return {
      name: customerName,
      email: email,
      address: fullAddress || 'No address'
    };
  };

  // Filtering and sorting logic
  const filteredAndSortedOrders = useMemo(() => {
    if (!purchaseOrders) return [];
    
    let filtered = purchaseOrders.filter(order => {
      const customerInfo = getCustomerInfo(order);
      const matchesSearch = !searchTerm || 
        order.poNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.sender?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.subject?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customerInfo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customerInfo.email.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const matchesRoute = routeFilter === "all" || order.route === routeFilter;
      
      return matchesSearch && matchesStatus && matchesRoute;
    });

    // Sort the filtered results
    filtered.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (sortField) {
        case 'poNumber':
          aValue = a.poNumber;
          bValue = b.poNumber;
          break;
        case 'customer':
          aValue = getCustomerInfo(a).name;
          bValue = getCustomerInfo(b).name;
          break;
        case 'orderDate':
          aValue = (a.extractedData as any)?.purchaseOrder?.orderDate || '';
          bValue = (b.extractedData as any)?.purchaseOrder?.orderDate || '';
          break;
        case 'status':
          aValue = a.status;
          bValue = b.status;
          break;
        case 'customerNumber':
          aValue = (a.extractedData as any)?.purchaseOrder?.customer?.customerNumber || '';
          bValue = (b.extractedData as any)?.purchaseOrder?.customer?.customerNumber || '';
          break;
        default:
          aValue = a.createdAt;
          bValue = b.createdAt;
      }
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return filtered;
  }, [purchaseOrders, searchTerm, statusFilter, routeFilter, sortField, sortDirection]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processed':
      case 'imported':
      case 'ready_for_netsuite':
        return { class: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle };
      case 'pending':
      case 'processing':
        return { class: 'bg-blue-100 text-blue-800 border-blue-200', icon: Clock };
      case 'pending_review':
        return { class: 'bg-amber-100 text-amber-800 border-amber-200', icon: Clock };
      case 'error':
        return { class: 'bg-red-100 text-red-800 border-red-200', icon: XCircle };
      default:
        return { class: 'bg-gray-100 text-gray-800 border-gray-200', icon: Clock };
    }
  };

  const getRouteBadge = (route: string) => {
    switch (route) {
      case 'ATTACHMENT_PO':
        return { class: 'bg-purple-100 text-purple-800 border-purple-200', label: 'PDF Attachment' };
      case 'TEXT_PO':
        return { class: 'bg-indigo-100 text-indigo-800 border-indigo-200', label: 'Email Text' };
      case 'REVIEW':
        return { class: 'bg-orange-100 text-orange-800 border-orange-200', label: 'Manual Review' };
      default:
        return { class: 'bg-gray-100 text-gray-800 border-gray-200', label: 'Unknown' };
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const formatDate = (dateInput: string | Date | null) => {
    if (!dateInput) return 'N/A';
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getLineItemsCount = (order: PurchaseOrder) => {
    const extractedData = order.extractedData as any;
    return extractedData?.lineItems?.length || 0;
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Purchase Order Admin Portal</h1>
            <p className="text-gray-600 mt-1">Manage and track purchase order processing pipeline</p>
          </div>
          <div className="flex items-center space-x-3">
            <Badge variant="outline" className="text-sm">
              {filteredAndSortedOrders.length} orders
            </Badge>
            <Button variant="outline" size="sm">
              <FileText className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button size="sm">
              <Hash className="w-4 h-4 mr-2" />
              Manual Entry
            </Button>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between space-x-4">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search by PO number, customer, or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="ready_for_netsuite">Ready for NetSuite</SelectItem>
                <SelectItem value="imported">Imported</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
            <Select value={routeFilter} onValueChange={setRouteFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by route" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Routes</SelectItem>
                <SelectItem value="ATTACHMENT_PO">PDF Attachment</SelectItem>
                <SelectItem value="TEXT_PO">Email Text</SelectItem>
                <SelectItem value="REVIEW">Manual Review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm">
            <Filter className="w-4 h-4 mr-2" />
            More Filters
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-600 mt-2">Loading purchase orders...</p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="w-[140px]">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleSort('poNumber')}
                    className="h-8 p-0 font-medium text-left"
                  >
                    Purchase Number
                    <ArrowUpDown className="ml-2 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead className="w-[100px]">Record ID</TableHead>
                <TableHead className="w-[110px]">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleSort('orderDate')}
                    className="h-8 p-0 font-medium text-left"
                  >
                    Order Date
                    <ArrowUpDown className="ml-2 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead className="w-[110px]">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleSort('createdAt')}
                    className="h-8 p-0 font-medium text-left"
                  >
                    Created
                    <ArrowUpDown className="ml-2 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead className="w-[200px]">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleSort('customer')}
                    className="h-8 p-0 font-medium text-left"
                  >
                    Customer
                    <ArrowUpDown className="ml-2 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead className="w-[200px]">Customer Email</TableHead>
                <TableHead className="w-[140px]">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleSort('status')}
                    className="h-8 p-0 font-medium text-left"
                  >
                    Status
                    <ArrowUpDown className="ml-2 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead className="w-[120px]">Route</TableHead>
                <TableHead className="w-[100px]">Line Items</TableHead>
                <TableHead className="w-[120px]">Customer Number</TableHead>
                <TableHead className="w-[120px]">Validated JSON</TableHead>
                <TableHead className="w-[100px]">PO KEY</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedOrders.map((order) => {
                const statusBadge = getStatusBadge(order.status);
                const routeBadge = getRouteBadge(order.route || '');
                const customer = getCustomerInfo(order);
                const lineItemsCount = getLineItemsCount(order);
                const StatusIcon = statusBadge.icon;
                
                return (
                  <TableRow key={order.id} className="hover:bg-gray-50">
                    <TableCell className="font-medium">
                      <div className="flex items-center space-x-2">
                        <Hash className="w-4 h-4 text-gray-400" />
                        <span className="text-blue-600 font-mono">{order.poNumber}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-500 text-sm font-mono">
                        {order.id.slice(0, 8)}...
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span className="text-sm">
                          {(order.extractedData as any)?.purchaseOrder?.orderDate || 'N/A'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {formatDate(order.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <div>
                          <div className="font-medium text-sm">{customer.name}</div>
                          <div className="text-xs text-gray-500 truncate max-w-[180px]">
                            {customer.address}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Mail className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600 truncate max-w-[180px]">
                          {customer.email}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${statusBadge.class} border`}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {order.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${routeBadge.class} border text-xs`}>
                        {routeBadge.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-center">
                        <Badge variant="outline" className="text-xs">
                          {lineItemsCount} items
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-center">
                        <span className="text-sm text-gray-600">
                          {(order.extractedData as any)?.purchaseOrder?.customer?.customerNumber || 'N/A'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-center">
                        <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                          {order.extractedData ? 'Valid' : 'Pending'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-center">
                        <span className="text-sm text-gray-600 font-mono">
                          {/* PO KEY to be populated later */}
                          --
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewOrder(order)}
                          className="h-8 w-8 p-0"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {order.status === 'ready_for_netsuite' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleImportToNetSuite(order.id)}
                            className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
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
                      <Badge className={`${getStatusBadge(selectedOrder.status).class} border`}>
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
                {/* Gemini Extracted Data */}
                {selectedOrder.extractedData && (selectedOrder.extractedData as any) && (
                  <div>
                    <h3 className="font-semibold text-sm text-gray-700 mb-2">Gemini Extracted Data</h3>
                    <div className="bg-blue-50 p-3 rounded-lg space-y-3 text-sm">
                      {(() => {
                        try {
                          const extractedData = typeof selectedOrder.extractedData === 'string' 
                            ? JSON.parse(selectedOrder.extractedData) 
                            : selectedOrder.extractedData;

                          return (
                            <>
                              {/* Purchase Order Info */}
                              {extractedData.purchaseOrder && (
                                <div className="space-y-2">
                                  <h4 className="font-medium text-blue-800">Purchase Order Details</h4>
                                  {extractedData.purchaseOrder.purchaseOrderNumber && (
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">PO Number:</span>
                                      <span className="font-medium text-green-600">{extractedData.purchaseOrder.purchaseOrderNumber}</span>
                                    </div>
                                  )}
                                  {extractedData.purchaseOrder.orderDate && (
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Order Date:</span>
                                      <span className="font-medium">{extractedData.purchaseOrder.orderDate}</span>
                                    </div>
                                  )}
                                  {extractedData.purchaseOrder.customer?.company && (
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Customer:</span>
                                      <span className="font-medium">{extractedData.purchaseOrder.customer.company}</span>
                                    </div>
                                  )}
                                  {extractedData.purchaseOrder.shippingMethod && (
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Shipping:</span>
                                      <span className="font-medium">{extractedData.purchaseOrder.shippingMethod}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              {/* Line Items */}
                              {extractedData.lineItems && extractedData.lineItems.length > 0 && (
                                <div className="space-y-2 border-t border-blue-200 pt-3">
                                  <h4 className="font-medium text-blue-800">Line Items ({extractedData.lineItems.length})</h4>
                                  {extractedData.lineItems.slice(0, 3).map((item: any, index: number) => (
                                    <div key={index} className="bg-white p-2 rounded border">
                                      <div className="flex justify-between items-start">
                                        <div className="flex-1">
                                          <div className="font-medium text-xs">{item.description || item.sku || 'Unknown Item'}</div>
                                          {item.sku && <div className="text-blue-600 text-xs font-mono">SKU: {item.sku}</div>}
                                          {item.finalSKU && <div className="text-green-600 text-xs font-mono">Final SKU: {item.finalSKU}</div>}
                                        </div>
                                        <div className="text-right ml-2">
                                          {item.quantity && <div className="font-medium text-xs">Qty: {item.quantity}</div>}
                                          {item.unitPrice && <div className="text-gray-600 text-xs">${item.unitPrice}</div>}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                  {extractedData.lineItems.length > 3 && (
                                    <div className="text-center text-xs text-gray-500">
                                      ... and {extractedData.lineItems.length - 3} more items
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              {/* Subtotals */}
                              {extractedData.subtotals?.grandTotal && (
                                <div className="border-t border-blue-200 pt-2">
                                  <div className="flex justify-between font-medium">
                                    <span className="text-gray-600">Grand Total:</span>
                                    <span className="text-green-600 font-bold">${extractedData.subtotals.grandTotal}</span>
                                  </div>
                                </div>
                              )}
                              
                              {/* Raw JSON expandable section */}
                              <div className="border-t border-blue-200 pt-3">
                                <details className="text-xs">
                                  <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
                                    View Complete JSON Data
                                  </summary>
                                  <div className="mt-2 p-3 bg-gray-100 rounded text-xs overflow-auto max-h-60 font-mono text-gray-700">
                                    <pre>{JSON.stringify(extractedData, null, 2)}</pre>
                                  </div>
                                </details>
                              </div>
                              
                              <div className="text-xs text-blue-600 border-t border-blue-200 pt-2 flex justify-between">
                                <span>Engine: {extractedData.engine || 'Gemini'}</span>
                                <span>Type: {extractedData.extractionType || 'Unknown'}</span>
                              </div>
                            </>
                          );
                        } catch (error) {
                          return (
                            <div className="text-xs text-red-600">
                              Error parsing extracted data: {error instanceof Error ? error.message : 'Unknown error'}
                            </div>
                          );
                        }
                      })()}
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
