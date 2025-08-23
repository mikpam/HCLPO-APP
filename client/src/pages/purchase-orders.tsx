import { useQuery, useMutation } from "@tanstack/react-query";
import { PurchaseOrder } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useMemo } from "react";
import { Eye, ExternalLink, FileText, Search, Filter, ArrowUpDown, MoreHorizontal, MapPin, Calendar, User, Users, Mail, Hash, CheckCircle, XCircle, Clock, Plus, Minus, FileText as FileTextIcon, Mail as MailIcon, Copy, RotateCcw, FileJson } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

export default function PurchaseOrdersPage() {
  const { toast } = useToast();
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fileViewModal, setFileViewModal] = useState<{
    isOpen: boolean;
    type: 'pdf' | 'eml' | null;
    content: string | null;
    title: string;
  }>({
    isOpen: false,
    type: null,
    content: null,
    title: ''
  });

  // Toggle expanded state for cells
  const toggleCellExpansion = (cellId: string) => {
    setExpandedCells(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cellId)) {
        newSet.delete(cellId);
      } else {
        newSet.add(cellId);
      }
      return newSet;
    });
  };

  const [sortField, setSortField] = useState("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  
  const { data: purchaseOrders, isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders"],
    refetchInterval: 30000
  });

  // Customer info extraction function
  const getCustomerInfo = (order: PurchaseOrder) => {
    const extractedData = order.extractedData as any;
    
    // Check for HCL customer lookup result first (highest priority)
    const customerMeta = order.customerMeta as any;
    if (customerMeta && 
        customerMeta.customer_number && 
        customerMeta.customer_number !== 'NO_CUSTOMER_NUMBER' &&
        customerMeta.customer_name !== 'NO_CUSTOMER_FOUND') {
      const customer = extractedData?.purchaseOrder?.customer || extractedData?.customer || {};
      return {
        name: customerMeta.customer_name,
        email: customer.email || order.sender || 'No email',
        address: customer.address1 ? 
          `${customer.address1}${customer.city ? `, ${customer.city}` : ''}${customer.state ? `, ${customer.state}` : ''}` : 
          'No address',
        customerNumber: customerMeta.customer_number,
        cNumber: null,
        isForwarded: false,
        isHclCustomer: true
      };
    }
    
    // Check for forwarded email data (priority for @highcaliberline.com emails)
    const forwardedEmail = extractedData?.forwardedEmail;
    if (forwardedEmail) {
      // Use HCL customer lookup if available, otherwise fall back to Gemini extraction
      const hclCustomer = forwardedEmail.hclCustomerLookup;
      const extractedCustomer = forwardedEmail.extractedCustomer;
      
      if (hclCustomer && 
          hclCustomer.customer_name && 
          hclCustomer.customer_name !== 'NO_CUSTOMER_FOUND' &&
          hclCustomer.customer_number !== 'NO_CUSTOMER_NUMBER') {
        // HCL database customer found
        return {
          name: hclCustomer.customer_name,
          email: extractedCustomer?.email || order.sender || 'No email',
          address: extractedCustomer?.address1 ? 
            `${extractedCustomer.address1}${extractedCustomer.city ? `, ${extractedCustomer.city}` : ''}${extractedCustomer.state ? `, ${extractedCustomer.state}` : ''}` : 
            'No address',
          customerNumber: hclCustomer.customer_number,
          cNumber: forwardedEmail.cNumber,
          isForwarded: true
        };
      } else if (extractedCustomer && extractedCustomer.company) {
        // Gemini extraction from forwarded email
        return {
          name: extractedCustomer.company,
          email: extractedCustomer.email || order.sender || 'No email',
          address: extractedCustomer.address1 ? 
            `${extractedCustomer.address1}${extractedCustomer.city ? `, ${extractedCustomer.city}` : ''}${extractedCustomer.state ? `, ${extractedCustomer.state}` : ''}` : 
            'No address',
          customerNumber: extractedCustomer.customerNumber || 'N/A',
          cNumber: forwardedEmail.cNumber,
          isForwarded: true
        };
      }
    }
    
    // Regular Gemini extraction (non-forwarded emails)
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
      address: fullAddress || 'No address',
      customerNumber: customer.customerNumber || 'N/A',
      isForwarded: false
    };
  };

  // Helper function to get contact information for NetSuite
  const getContactInfo = (order: any) => {
    const extractedData = order.extractedData;
    const contactMeta = order.contactMeta;
    const contact = extractedData?.purchaseOrder?.contact;
    
    if (contactMeta) {
      // Use validated contact from HCL database
      // Backend stores as contact_name, contact_email, contact_phone
      return {
        name: contactMeta.contact_name || contactMeta.name || 'N/A',
        email: contactMeta.contact_email || contactMeta.email || 'N/A',
        phone: contactMeta.contact_phone || contactMeta.phone || 'N/A',
        jobTitle: contactMeta.job_title || 'N/A',
        isValidated: contactMeta.is_verified || true
      };
    } else if (contact) {
      // Use extracted contact information
      return {
        name: contact.name || 'N/A',
        email: contact.email || 'N/A', 
        phone: contact.phone || 'N/A',
        jobTitle: contact.jobTitle || 'N/A',
        isValidated: false
      };
    } else if (order.contact) {
      // Use simple contact name field
      return {
        name: order.contact,
        email: 'N/A',
        phone: 'N/A',
        jobTitle: 'N/A',
        isValidated: false
      };
    }
    
    return {
      name: 'Not provided',
      email: 'N/A',
      phone: 'N/A', 
      jobTitle: 'N/A',
      isValidated: false
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
      
      return matchesSearch && matchesStatus;
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
  }, [purchaseOrders, searchTerm, statusFilter, sortField, sortDirection]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processed':
      case 'imported':
      case 'ready_for_netsuite':
        return { class: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle };
      case 'sent_to_netsuite':
        return { class: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: CheckCircle };
      case 'pending':
      case 'processing':
        return { class: 'bg-blue-100 text-blue-800 border-blue-200', icon: Clock };
      case 'pending_review':
        return { class: 'bg-amber-100 text-amber-800 border-amber-200', icon: Clock };
      case 'new_customer':
        return { class: 'bg-purple-100 text-purple-800 border-purple-200', icon: User };
      case 'error':
        return { class: 'bg-red-100 text-red-800 border-red-200', icon: XCircle };
      case 'manual_review':
        return { class: 'bg-orange-100 text-orange-800 border-orange-200', icon: User };
      default:
        return { class: 'bg-gray-100 text-gray-800 border-gray-200', icon: Clock };
    }
  };

  const getStatusDisplayText = (status: string) => {
    switch (status) {
      case 'manual_review':
        return 'For human review';
      case 'new_customer':
        return 'New customer';
      case 'pending_review':
        return 'Pending review';
      case 'ready_for_netsuite':
        return 'Ready for NetSuite';
      case 'sent_to_netsuite':
        return 'Sent to NetSuite';
      default:
        // For other statuses, convert snake_case to Title Case
        return status.split('_').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
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

  const getValidationBadge = (extractedData: any) => {
    if (extractedData) {
      return { class: 'text-xs bg-green-50 text-green-700 border-green-200', label: 'Valid' };
    } else {
      return { class: 'text-xs bg-gray-50 text-gray-700 border-gray-200', label: 'Pending' };
    }
  };

  const handleImportToNetSuite = async (orderId: string) => {
    try {
      const response = await fetch(`/api/purchase-orders/${orderId}/import-netsuite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send to NetSuite');
      }
      
      const result = await response.json();
      
      // Show success toast
      toast({
        title: "Sent to NetSuite",
        description: result.message || `PO has been sent to NetSuite`,
        variant: "default"
      });
      
      // Refetch data without page reload
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      
    } catch (error: any) {
      console.error('Error sending to NetSuite:', error);
      toast({
        title: "Failed to send to NetSuite",
        description: error.message || 'An error occurred while sending to NetSuite',
        variant: "destructive"
      });
    }
  };

  const handleViewOrder = (order: PurchaseOrder) => {
    setSelectedOrder(order);
    setIsViewModalOpen(true);
  };

  // Retry mutation for failed/stuck POs
  const retryMutation = useMutation({
    mutationFn: async (poId: string) => {
      const response = await fetch(`/api/processing/retry-dead-letter/${poId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to retry purchase order');
      }
      
      return response.json();
    },
    onSuccess: (data: any, poId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({
        title: "Retry Started",
        description: data.success ? "Purchase order retry initiated successfully" : data.message,
        variant: data.success ? "default" : "destructive"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Retry Failed",
        description: error.message || "Failed to retry purchase order",
        variant: "destructive"
      });
    }
  });

  const handleViewFile = async (filePath: string, type: 'pdf' | 'eml', title: string) => {
    try {
      if (type === 'pdf') {
        // For PDFs, open in new tab (same as file management tab)
        const pdfUrl = filePath.startsWith('/objects/') ? filePath : `/objects/attachments/${filePath.split('/').pop()}`;
        window.open(pdfUrl, '_blank');
      } else {
        // For EML files, show available purchase order information instead of trying to fetch from storage
        const order = filteredAndSortedOrders.find(o => 
          o.emlFilePath === filePath || 
          (title && title.includes(o.poNumber))
        );
        
        if (!order) {
          setFileViewModal({
            isOpen: true,
            type,
            content: 'Purchase order not found for this EML file.',
            title: 'Email Information - Not Found'
          });
          return;
        }

        // Get customer info using the same function as the table
        const customerInfo = getCustomerInfo(order);
        
        // Calculate total from line items
        const lineItems = (order.lineItems as any[]) || [];
        const totalAmount = lineItems.reduce((sum, item) => {
          const price = parseFloat(item?.unitPrice || item?.price || '0');
          const qty = parseInt(item?.quantity || '1');
          return sum + (price * qty);
        }, 0);
        
        let emailInfo = `=== EMAIL INFORMATION ===

Purchase Order: ${order.poNumber || 'N/A'}
Customer: ${customerInfo.name || 'N/A'}  
Total Amount: ${totalAmount > 0 ? `$${totalAmount.toFixed(2)}` : 'N/A'}
Processing Date: ${order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A'}

Status: Email successfully processed and purchase order created
Source: Email processing system
File Path: ${filePath}

Note: The original email file is stored in the system but cannot be displayed 
due to object storage configuration. All email data has been extracted 
and is available in the purchase order details above.

=== PURCHASE ORDER DETAILS ===

Line Items: ${lineItems.length} items
${lineItems.map((item, i) => 
  `${i + 1}. ${item?.description || item?.sku || 'Unknown Item'} - Qty: ${item?.quantity || '1'} - $${item?.unitPrice || item?.price || 'N/A'}`
).join('\n') || 'No line items available'}

=== END EMAIL INFORMATION ===`;
        
        setFileViewModal({
          isOpen: true,
          type,
          content: emailInfo,
          title: `Email Information - PO ${order?.poNumber || 'Unknown'}`
        });
      }
    } catch (error) {
      console.error('Error loading file:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 lg:px-6 py-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between space-y-4 lg:space-y-0">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold text-gray-900">Purchase Order Admin Portal</h1>
            <p className="text-gray-600 mt-1 text-sm lg:text-base">Manage and track purchase order processing pipeline</p>
          </div>
          <div className="flex items-center space-x-2 lg:space-x-3">
            <Badge variant="outline" className="text-xs lg:text-sm">
              {filteredAndSortedOrders.length} orders
            </Badge>
            <Button variant="outline" size="sm" className="hidden lg:flex">
              <FileText className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button size="sm">
              <Hash className="w-4 h-4 mr-2" />
              <span className="hidden lg:inline">Manual Entry</span>
              <span className="lg:hidden">Add</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white border-b border-gray-200 px-4 lg:px-6 py-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between space-y-4 lg:space-y-0 lg:space-x-4">
          <div className="flex flex-col lg:flex-row lg:items-center space-y-4 lg:space-y-0 lg:space-x-4 flex-1">
            <div className="relative flex-1 lg:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search by PO number, customer, or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex space-x-2 lg:space-x-4">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full lg:w-48">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="ready_for_netsuite">Ready for NetSuite</SelectItem>
                  <SelectItem value="pending_review">Pending Review</SelectItem>
                  <SelectItem value="new_customer">New Customer</SelectItem>
                  <SelectItem value="imported">Imported</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>

            </div>
          </div>
          <Button variant="outline" size="sm" className="hidden lg:flex">
            <Filter className="w-4 h-4 mr-2" />
            More Filters
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-600 mt-2">Loading purchase orders...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden lg:block">
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

                    <TableHead className="w-[180px]">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleSort('id')}
                        className="h-8 p-0 font-medium text-left"
                      >
                        Database ID (UUID)
                        <ArrowUpDown className="ml-2 h-3 w-3" />
                      </Button>
                    </TableHead>

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
                    <TableHead className="w-[80px]">Email</TableHead>
                    <TableHead className="w-[160px]">Contact</TableHead>
                    <TableHead className="w-[100px]">Intent</TableHead>
                    <TableHead className="w-[180px]">Ship To</TableHead>
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
                    <TableHead className="w-[200px]">Review Reason</TableHead>
                    <TableHead className="w-[400px]">Line Items</TableHead>
                    <TableHead className="w-[120px]">Customer Number</TableHead>
                    <TableHead className="w-[100px]">Source Document</TableHead>
                    <TableHead className="w-[80px]">EML</TableHead>
                    <TableHead className="w-[120px]">Validated JSON</TableHead>
                    <TableHead className="w-[120px]">NS Payload</TableHead>
                    <TableHead className="w-[100px]">PO KEY</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedOrders.map((order) => {
                    const statusBadge = getStatusBadge(order.status);
                    const customer = getCustomerInfo(order);
                    const contact = getContactInfo(order);
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
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">
                              {order.id.substring(0, 8)}...
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 hover:bg-gray-200"
                              onClick={() => {
                                navigator.clipboard.writeText(order.id);
                                toast({
                                  title: "UUID Copied",
                                  description: "Database ID copied to clipboard",
                                  duration: 2000,
                                });
                              }}
                              title="Copy full UUID"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
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
                          <div className="space-y-1">
                            <div className="text-sm text-gray-900">
                              {formatDate(order.createdAt)}
                            </div>
                            <div className="text-xs text-gray-500">
                              {order.createdAt ? new Date(order.createdAt).toLocaleTimeString('en-US', { 
                                hour: '2-digit', 
                                minute: '2-digit', 
                                second: '2-digit' 
                              }) : 'N/A'}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <User className="w-4 h-4 text-gray-400" />
                              <span className="font-medium text-sm">{customer.name}</span>
                              {customer.isForwarded && (
                                <Badge variant="secondary" className="text-xs px-1 py-0.5">
                                  Forwarded
                                </Badge>
                              )}
                            </div>
                            {customer.cNumber && (
                              <div className="flex items-center space-x-2">
                                <Hash className="w-3 h-3 text-blue-400" />
                                <span className="text-xs text-blue-600 font-mono">
                                  C{customer.cNumber}
                                </span>
                              </div>
                            )}
                            <div className="flex items-center space-x-2">
                              <MapPin className="w-3 h-3 text-gray-400" />
                              <span className="text-xs text-gray-500 truncate max-w-[150px]">
                                {customer.address}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className={(() => {
                          const emailCellId = `email-${order.id}`;
                          const isExpanded = expandedCells.has(emailCellId);
                          return isExpanded ? 'min-w-[180px] max-w-[200px]' : 'max-w-[80px]';
                        })()}>
                          <div className="flex items-start space-x-1">
                            {(() => {
                              const emailCellId = `email-${order.id}`;
                              const isExpanded = expandedCells.has(emailCellId);
                              const emailTruncated = customer.email.length > 12;
                              
                              return (
                                <>
                                  <span 
                                    className={`text-xs text-gray-600 ${isExpanded ? 'break-all' : 'truncate'} block ${isExpanded ? 'max-w-[160px]' : 'max-w-[50px]'}`}
                                    title={customer.email}
                                  >
                                    {customer.email}
                                  </span>
                                  {emailTruncated && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => toggleCellExpansion(emailCellId)}
                                      className="h-4 w-4 p-0 flex-shrink-0 text-gray-400 hover:text-gray-600 mt-0"
                                    >
                                      {isExpanded ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                                    </Button>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <Users className="w-4 h-4 text-gray-400" />
                              <span className="font-medium text-sm">{contact.name}</span>
                              {contact.isValidated && (
                                <Badge variant="secondary" className="text-xs px-1 py-0.5">
                                  Verified
                                </Badge>
                              )}
                            </div>
                            {contact.jobTitle !== 'N/A' && (
                              <div className="text-xs text-gray-500 pl-6">
                                {contact.jobTitle}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {order.emailIntent ? order.emailIntent.replace(/_/g, ' ') : 'none'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const shipTo = order.shipToAddress as any;
                            if (!shipTo) return <span className="text-gray-400 text-sm">No address</span>;
                            
                            return (
                              <div className="text-xs space-y-0.5">
                                {shipTo.company && <div className="font-medium">{shipTo.company}</div>}
                                {shipTo.name && <div>{shipTo.name}</div>}
                                {shipTo.address1 && <div>{shipTo.address1}</div>}
                                {(shipTo.city || shipTo.state || shipTo.zipCode) && (
                                  <div>
                                    {[shipTo.city, shipTo.state, shipTo.zipCode].filter(Boolean).join(', ')}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${statusBadge.class} text-xs`}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {getStatusDisplayText(order.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {(order.status === 'manual_review' || order.status === 'invalid_items') ? (
                            <div className="text-xs text-gray-600">
                              {order.errorReason || 
                                (order.status === 'invalid_items' ? 'Invalid or missing item SKUs' : 
                                  (!order.extractedData ? 'No extracted data' : 
                                    (!order.lineItems || order.lineItems.length === 0 ? 'No line items' : 
                                      'Validation required')))}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[400px]">
                            {(() => {
                              const extractedData = order.extractedData as any;
                              const lineItems = extractedData?.lineItems || [];
                              const lineItemsCellId = `lineitems-${order.id}`;
                              const isExpanded = expandedCells.has(lineItemsCellId);
                              
                              if (lineItems.length === 0) return <span className="text-gray-400 text-sm">No items</span>;
                              
                              // Show all processed line items - validated and unvalidated
                              const displayItems = isExpanded ? lineItems : lineItems.slice(0, 2);
                              const hasMore = lineItems.length > 2;
                              
                              return (
                                <div className="space-y-1">
                                  {displayItems.map((item: any, index: number) => {
                                    const hasValidSKU = item.finalSKU && item.finalSKU.trim() !== '';
                                    const displaySKU = hasValidSKU ? item.finalSKU : item.sku;
                                    const bgColor = hasValidSKU ? 'bg-blue-50' : 'bg-orange-50';
                                    const textColor = hasValidSKU ? 'text-blue-700' : 'text-orange-700';
                                    
                                    return (
                                      <div key={index} className={`flex items-center justify-between text-xs ${bgColor} rounded px-2 py-1`}>
                                        <span className={`font-mono font-medium ${textColor}`}>{displaySKU}</span>
                                        <span className="text-gray-600 ml-2 flex-shrink-0">Qty: {item.quantity || 0}</span>
                                      </div>
                                    );
                                  })}
                                  {hasMore && (
                                    <div className="flex items-center space-x-1">
                                      {!isExpanded && (
                                        <span className="text-xs text-gray-500">+{lineItems.length - 2} more</span>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => toggleCellExpansion(lineItemsCellId)}
                                        className="h-5 w-5 p-0 text-gray-400 hover:text-gray-600"
                                      >
                                        {isExpanded ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <span className="font-mono text-sm text-blue-600">
                              {customer.customerNumber || 'N/A'}
                            </span>
                            {customer.isForwarded && customer.cNumber && (
                              <div className="text-xs text-gray-500">
                                HCL: C{customer.cNumber}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {order.extractionSourceFile ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewFile(order.extractionSourceFile!, 'pdf', `${order.poNumber} - Source Document`)}
                              className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-800 text-sm h-8"
                            >
                              <FileTextIcon className="w-4 h-4" />
                              <span>View Source</span>
                            </Button>
                          ) : order.route === 'TEXT_PO' ? (
                            <span className="text-gray-500 text-sm">Email Text</span>
                          ) : (
                            <span className="text-gray-400 text-sm">No extraction</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {order.emlFilePath ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewFile(order.emlFilePath!, 'eml', `${order.poNumber} - Email`)}
                              className="inline-flex items-center space-x-1 text-green-600 hover:text-green-800 text-sm h-8"
                            >
                              <MailIcon className="w-4 h-4" />
                              <span>View EML</span>
                            </Button>
                          ) : (
                            <span className="text-gray-400 text-sm">No EML</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline"
                            className={getValidationBadge(order.extractedData).class}
                          >
                            {getValidationBadge(order.extractedData).label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {order.nsPayload ? (
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const jsonStr = JSON.stringify(order.nsPayload, null, 2);
                                  navigator.clipboard.writeText(jsonStr);
                                  toast({
                                    title: "NS Payload Copied",
                                    description: "NetSuite payload copied to clipboard",
                                    duration: 2000,
                                  });
                                }}
                                className="inline-flex items-center space-x-1 text-purple-600 hover:text-purple-800 text-sm h-8"
                              >
                                <FileJson className="w-4 h-4" />
                                <span>View NS</span>
                              </Button>
                              {order.status === 'sent_to_netsuite' && (
                                <Badge variant="secondary" className="text-xs bg-emerald-50 text-emerald-700">
                                  Sent
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-sm">Not ready</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-gray-400 text-sm">-</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewOrder(order)}
                              className="h-8 w-8 p-0"
                              data-testid={`button-view-${order.id}`}
                              title="View PO Details"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {(order.status === 'ready_for_netsuite' || order.status === 'sent_to_netsuite') && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleImportToNetSuite(order.id)}
                                className={order.status === 'sent_to_netsuite' 
                                  ? "h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700" 
                                  : "h-8 w-8 p-0 text-green-600 hover:text-green-700"
                                }
                                data-testid={`button-import-${order.id}`}
                                title={order.status === 'sent_to_netsuite' 
                                  ? "Already sent to NetSuite - Click to resend" 
                                  : "Send to NetSuite"
                                }
                                disabled={order.status === 'sent_to_netsuite'}
                              >
                                {order.status === 'sent_to_netsuite' ? (
                                  <CheckCircle className="w-4 h-4" />
                                ) : (
                                  <ExternalLink className="w-4 h-4" />
                                )}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => retryMutation.mutate(order.id)}
                              disabled={retryMutation.isPending}
                              className="h-8 w-8 p-0 text-orange-600 hover:text-orange-700"
                              data-testid={`button-retry-${order.id}`}
                              title="Retry Processing"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Card View */}
            <div className="lg:hidden px-4 py-4 space-y-4">
              {filteredAndSortedOrders.map((order) => {
                const statusBadge = getStatusBadge(order.status);
                const customer = getCustomerInfo(order);
                const contact = getContactInfo(order);
                const lineItemsCount = getLineItemsCount(order);
                const StatusIcon = statusBadge.icon;
                
                return (
                  <Card key={order.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <Hash className="w-4 h-4 text-gray-400" />
                          <span className="text-blue-600 font-mono font-semibold">{order.poNumber}</span>
                          {customer.isForwarded && (
                            <Badge variant="secondary" className="text-xs px-1 py-0.5">
                              Forwarded
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <Badge className={`${statusBadge.class} text-xs`}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {getStatusDisplayText(order.status)}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewOrder(order)}
                            className="h-8 w-8 p-0"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      
                      {/* Error Reason for Manual Review */}
                      {(order.status === 'manual_review' || order.status === 'invalid_items') && (
                        <div className="bg-orange-50 border border-orange-200 rounded-md p-2 mb-2">
                          <div className="text-xs text-orange-700 font-medium">
                            Review Reason: {order.errorReason || 
                              (order.status === 'invalid_items' ? 'Invalid or missing item SKUs' : 
                                (!order.extractedData ? 'No extracted data' : 
                                  (!order.lineItems || order.lineItems.length === 0 ? 'No line items' : 
                                    'Validation required')))}
                          </div>
                        </div>
                      )}
                      
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <User className="w-4 h-4 text-gray-400" />
                          <span className="font-medium text-sm">{customer.name}</span>
                        </div>
                        
                        {customer.cNumber && (
                          <div className="flex items-center space-x-2">
                            <Hash className="w-4 h-4 text-blue-400" />
                            <span className="text-sm text-blue-600 font-mono">
                              HCL: C{customer.cNumber}
                            </span>
                          </div>
                        )}
                        
                        <div className="flex items-center space-x-2">
                          <Users className="w-4 h-4 text-gray-400" />
                          <span className="font-medium text-sm">{contact.name}</span>
                          {contact.isValidated && (
                            <Badge variant="secondary" className="text-xs px-1 py-0.5">
                              Verified
                            </Badge>
                          )}
                        </div>
                        
                        {contact.jobTitle !== 'N/A' && (
                          <div className="text-xs text-gray-500 pl-6">
                            {contact.jobTitle}
                          </div>
                        )}
                        
                        <div>
                          <span className="text-sm text-gray-600 truncate">{customer.email}</span>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            <div className="space-y-0">
                              <div className="text-sm text-gray-900">
                                {formatDate(order.createdAt)}
                              </div>
                              <div className="text-xs text-gray-500">
                                {order.createdAt ? new Date(order.createdAt).toLocaleTimeString('en-US', { 
                                  hour: '2-digit', 
                                  minute: '2-digit', 
                                  second: '2-digit' 
                                }) : 'N/A'}
                              </div>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {(() => {
                              const extractedData = order.extractedData as any;
                              const lineItems = extractedData?.lineItems || [];
                              const mobileLineItemsCellId = `mobile-lineitems-${order.id}`;
                              const isExpanded = expandedCells.has(mobileLineItemsCellId);
                              
                              if (lineItems.length === 0) return <span className="text-gray-400 text-xs">No items</span>;
                              
                              // Show all processed line items - validated and unvalidated
                              const displayItems = isExpanded ? lineItems : lineItems.slice(0, 2);
                              const hasMore = lineItems.length > 2;
                              
                              return (
                                <div className="space-y-1">
                                  {displayItems.map((item: any, index: number) => {
                                    const hasValidSKU = item.finalSKU && item.finalSKU.trim() !== '';
                                    const displaySKU = hasValidSKU ? item.finalSKU : item.sku;
                                    const bgColor = hasValidSKU ? 'bg-blue-50' : 'bg-orange-50';
                                    const textColor = hasValidSKU ? 'text-blue-700' : 'text-orange-700';
                                    
                                    return (
                                      <div key={index} className={`flex items-center justify-between text-xs ${bgColor} rounded px-2 py-1`}>
                                        <span className={`font-mono font-medium ${textColor}`}>{displaySKU}</span>
                                        <span className="text-gray-600 ml-2 flex-shrink-0">Qty: {item.quantity || 0}</span>
                                      </div>
                                    );
                                  })}
                                  {hasMore && (
                                    <div className="flex items-center space-x-1">
                                      {!isExpanded && (
                                        <span className="text-xs text-gray-500">+{lineItems.length - 2} more</span>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => toggleCellExpansion(mobileLineItemsCellId)}
                                        className="h-5 w-5 p-0 text-gray-400 hover:text-gray-600"
                                      >
                                        {isExpanded ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                          <div className="flex items-center space-x-4">
                            <span className="text-xs text-gray-500">
                              {lineItemsCount} items
                            </span>
                            <span className="font-mono text-xs text-blue-600">
                              {customer.customerNumber || 'N/A'}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewOrder(order)}
                              className="h-8 w-8 p-0"
                              data-testid={`button-view-mobile-${order.id}`}
                              title="View PO Details"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {order.status === 'ready_for_netsuite' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleImportToNetSuite(order.id)}
                                className="h-8 w-8 p-0 text-green-600 hover:text-green-700"
                                data-testid={`button-import-mobile-${order.id}`}
                                title="Import to NetSuite"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => retryMutation.mutate(order.id)}
                              disabled={retryMutation.isPending}
                              className="h-8 w-8 p-0 text-orange-600 hover:text-orange-700"
                              data-testid={`button-retry-mobile-${order.id}`}
                              title="Retry Processing"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
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
                        {getStatusDisplayText(selectedOrder.status)}
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

                {/* Contact Information */}
                <div>
                  <h3 className="font-semibold text-sm text-gray-700 mb-2">Contact Information</h3>
                  <div className="space-y-2 text-sm">
                    {(() => {
                      const contact = getContactInfo(selectedOrder);
                      return (
                        <>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Contact Name:</span>
                            <div className="flex items-center space-x-2">
                              <span className="font-medium">{contact.name}</span>
                              {contact.isValidated && (
                                <Badge variant="secondary" className="text-xs px-1 py-0.5">
                                  Verified
                                </Badge>
                              )}
                            </div>
                          </div>
                          {contact.email !== 'N/A' && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Contact Email:</span>
                              <span className="font-medium">{contact.email}</span>
                            </div>
                          )}
                          {contact.phone !== 'N/A' && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Contact Phone:</span>
                              <span className="font-medium">{contact.phone}</span>
                            </div>
                          )}
                          {contact.jobTitle !== 'N/A' && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Job Title:</span>
                              <span className="font-medium">{contact.jobTitle}</span>
                            </div>
                          )}
                        </>
                      );
                    })()}
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

      {/* File Viewing Modal */}
      <Dialog open={fileViewModal.isOpen} onOpenChange={(open) => 
        setFileViewModal(prev => ({ ...prev, isOpen: open }))
      }>
        <DialogContent className="max-w-4xl w-full h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{fileViewModal.title}</DialogTitle>
            <DialogDescription>
              {fileViewModal.type === 'pdf' ? 'PDF Attachment Content' : 'Email File Content'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {fileViewModal.type === 'eml' && (
              <div className="bg-gray-50 p-4 rounded-lg">
                <pre className="whitespace-pre-wrap text-sm font-mono">
                  {fileViewModal.content}
                </pre>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
