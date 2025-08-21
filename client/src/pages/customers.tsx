import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Search, 
  Users, 
  Building2, 
  Phone, 
  Mail, 
  MapPin,
  Eye,
  Filter,
  Download,
  Plus,
  Edit,
  Trash2
} from "lucide-react";
import { CustomerFormModal } from "@/components/customers/CustomerFormModal";
import { DeleteCustomerModal } from "@/components/customers/DeleteCustomerModal";
import type { Customer as CustomerType } from "@shared/schema";

// Use the Customer interface from shared schema, but create a mapping for the API response
interface CustomerApiResponse {
  id: string;
  customer_number: string;
  company_name: string;
  alternate_names: string[];
  email: string;
  phone: string;
  address: any;
  netsuite_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Helper function to convert API response to schema format
function convertToCustomer(apiCustomer: CustomerApiResponse): CustomerType {
  return {
    id: apiCustomer.id,
    customerNumber: apiCustomer.customer_number,
    companyName: apiCustomer.company_name,
    alternateNames: apiCustomer.alternate_names,
    email: apiCustomer.email,
    phone: apiCustomer.phone,
    address: apiCustomer.address,
    netsuiteId: apiCustomer.netsuite_id,
    isActive: apiCustomer.is_active,
    searchVector: null,
    createdAt: new Date(apiCustomer.created_at),
    updatedAt: new Date(apiCustomer.updated_at),
  };
}

function CustomerModal({ customer }: { customer: CustomerApiResponse }) {
  return (
    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          {customer.company_name}
        </DialogTitle>
      </DialogHeader>
      
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-500">Customer Number</label>
              <p className="text-lg font-mono">{customer.customer_number}</p>
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-500">NetSuite ID</label>
              <p className="text-sm">{customer.netsuite_id || "Not assigned"}</p>
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-500">Status</label>
              <div className="mt-1">
                <Badge variant={customer.is_active ? "default" : "secondary"}>
                  {customer.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-500">Email</label>
              <p className="text-sm flex items-center gap-2">
                <Mail className="h-4 w-4" />
                {customer.email || "No email"}
              </p>
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-500">Phone</label>
              <p className="text-sm flex items-center gap-2">
                <Phone className="h-4 w-4" />
                {customer.phone || "No phone"}
              </p>
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-500">Address</label>
              <p className="text-sm flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5" />
                {customer.address && Object.keys(customer.address).length > 0 
                  ? JSON.stringify(customer.address) 
                  : "No address"
                }
              </p>
            </div>
          </div>
        </div>
        
        {customer.alternate_names?.length > 0 && (
          <div>
            <label className="text-sm font-medium text-gray-500">Alternate Names</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {customer.alternate_names.map((name, index) => (
                <Badge key={index} variant="outline" className="text-xs">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-500">
          <div>
            <label className="font-medium">Created</label>
            <p>{new Date(customer.created_at).toLocaleString()}</p>
          </div>
          <div>
            <label className="font-medium">Last Updated</label>
            <p>{new Date(customer.updated_at).toLocaleString()}</p>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

export default function CustomersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [currentPage, setCurrentPage] = useState(1);
  
  // Use larger limit when searching to show all results, smaller limit for initial load
  const itemsPerPage = debouncedSearchTerm && debouncedSearchTerm.trim() 
    ? 10000  // Show all search results
    : 50;    // Initial load: 50 records
  
  // CRUD modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerType | undefined>(undefined);

  // Debounce search term to avoid API calls on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      // Reset to page 1 when search changes
      if (searchTerm !== debouncedSearchTerm) {
        setCurrentPage(1);
      }
    }, 500); // 500ms delay

    return () => clearTimeout(timer);
  }, [searchTerm, debouncedSearchTerm]);

  const { data: customers = [], isLoading, error } = useQuery<CustomerApiResponse[]>({
    queryKey: ["/api/customers", currentPage, debouncedSearchTerm, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
        status: statusFilter,
      });
      
      if (debouncedSearchTerm) {
        params.append('search', debouncedSearchTerm);
      }
      
      const response = await fetch(`/api/customers?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch customers");
      }
      return response.json();
    },
  });

  // Server-side filtering and pagination - no client-side processing needed
  const totalPages = Math.ceil((customers?.length || 0) / itemsPerPage);

  if (error) {
    return (
      <div className="p-4 md:p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Error loading customers. Please try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="h-6 w-6" />
            Customer Management
          </h1>
          <p className="text-gray-600 mt-1">
            Manage and view HCL customer database
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            onClick={() => setCreateModalOpen(true)}
            size="sm" 
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Customer
          </Button>
          <Button variant="outline" size="sm" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Customers</p>
                <p className="text-2xl font-bold">
                  {isLoading ? "..." : customers.length.toLocaleString()}
                </p>
              </div>
              <Users className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Customers</p>
                <p className="text-2xl font-bold">
                  {isLoading ? "..." : customers.filter(c => c.is_active).length.toLocaleString()}
                </p>
              </div>
              <Building2 className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Filtered Results</p>
                <p className="text-2xl font-bold">
                  {isLoading ? "..." : customers.length.toLocaleString()}
                </p>
              </div>
              <Filter className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Search & Filter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search by company name, customer number, email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                <SelectItem value="active">Active Only</SelectItem>
                <SelectItem value="inactive">Inactive Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Customer Directory</span>
            <span className="text-sm font-normal text-gray-500">
              Showing {customers.length} customers (page {currentPage})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <>
              {/* Mobile View */}
              <div className="block md:hidden space-y-3">
                {customers.map((customer: CustomerApiResponse) => (
                  <Card key={customer.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <p className="font-semibold">{customer.company_name}</p>
                        <p className="text-sm text-gray-600 font-mono">{customer.customer_number}</p>
                        {customer.email && (
                          <p className="text-sm text-gray-500">{customer.email}</p>
                        )}
                        <Badge variant={customer.is_active ? "default" : "secondary"} className="text-xs">
                          {customer.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      
                      <div className="flex gap-1">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <CustomerModal customer={customer} />
                        </Dialog>
                        
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            setSelectedCustomer(convertToCustomer(customer));
                            setEditModalOpen(true);
                          }}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            setSelectedCustomer(convertToCustomer(customer));
                            setDeleteModalOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Desktop View */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer Number</TableHead>
                      <TableHead>Company Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>NetSuite ID</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((customer: CustomerApiResponse) => (
                      <TableRow key={customer.id}>
                        <TableCell className="font-mono">{customer.customer_number}</TableCell>
                        <TableCell className="font-medium">{customer.company_name}</TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {customer.email || "—"}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {customer.phone || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={customer.is_active ? "default" : "secondary"}>
                            {customer.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {customer.netsuite_id || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="outline" size="sm">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <CustomerModal customer={customer} />
                            </Dialog>
                            
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                setSelectedCustomer(convertToCustomer(customer));
                                setEditModalOpen(true);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                setSelectedCustomer(convertToCustomer(customer));
                                setDeleteModalOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Page {currentPage} of {totalPages}
          </p>
          
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(currentPage - 1)}
            >
              Previous
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* CRUD Modals */}
      <CustomerFormModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        mode="create"
      />
      
      <CustomerFormModal
        isOpen={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setSelectedCustomer(undefined);
        }}
        customer={selectedCustomer}
        mode="edit"
      />
      
      <DeleteCustomerModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setSelectedCustomer(undefined);
        }}
        customer={selectedCustomer}
      />
    </div>
  );
}