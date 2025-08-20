import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Search, 
  Users, 
  User, 
  Phone, 
  Mail, 
  Eye,
  Filter,
  Download,
  CheckCircle,
  XCircle,
  Calendar,
  Plus,
  Edit,
  Trash2,
  RotateCcw,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Contact interface based on the schema
interface Contact {
  id: string;
  netsuite_internal_id: string;
  name: string;
  job_title: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  office_phone: string | null;
  fax: string | null;
  alt_email: string | null;
  inactive: boolean;
  duplicate: boolean;
  login_access: boolean;
  verified: boolean;
  last_verified_at: string | null;
  last_verified_method: string | null;
  verification_confidence: number | null;
  created_at: string;
  updated_at: string;
}

interface ContactsResponse {
  data: Contact[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Form schemas
const contactFormSchema = z.object({
  netsuiteInternalId: z.string().min(1, "NetSuite ID is required"),
  name: z.string().min(1, "Name is required"),
  jobTitle: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  inactive: z.boolean().default(false),
  duplicate: z.boolean().default(false),
  loginAccess: z.boolean().default(false),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

export default function ContactsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [verificationFilter, setVerificationFilter] = useState<string>("all");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: contactsResponse, isLoading } = useQuery<ContactsResponse>({
    queryKey: ['/api/contacts', currentPage, searchTerm, statusFilter, verificationFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: pageSize.toString(),
      });
      
      if (searchTerm) params.append('search', searchTerm);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (verificationFilter !== 'all') params.append('verification', verificationFilter);
      
      const response = await fetch(`/api/contacts?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch contacts');
      }
      return response.json();
    }
  });

  const contacts = contactsResponse?.data || [];
  const pagination = contactsResponse?.pagination;

  // Get stats for all contacts (not filtered view)
  const { data: stats } = useQuery({
    queryKey: ['/api/contacts/stats'],
    queryFn: async () => {
      const response = await fetch('/api/contacts/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    }
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: ContactFormData) => {
      return apiRequest('POST', '/api/contacts', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/stats'] });
      setIsCreateModalOpen(false);
      toast({ title: "Contact created successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error creating contact", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ContactFormData> }) => {
      return apiRequest('PUT', `/api/contacts/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      setIsEditModalOpen(false);
      setSelectedContact(null);
      toast({ title: "Contact updated successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error updating contact", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/contacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/stats'] });
      setIsDeleteDialogOpen(false);
      setContactToDelete(null);
      toast({ title: "Contact deactivated successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error deleting contact", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  // Reactivate mutation
  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('PATCH', `/api/contacts/${id}/reactivate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/stats'] });
      toast({ title: "Contact reactivated successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error reactivating contact", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  // Form setup
  const createForm = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      netsuiteInternalId: "",
      name: "",
      jobTitle: "",
      phone: "",
      email: "",
      inactive: false,
      duplicate: false,
      loginAccess: false,
    }
  });

  const editForm = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      netsuiteInternalId: "",
      name: "",
      jobTitle: "",
      phone: "",
      email: "",
      inactive: false,
      duplicate: false,
      loginAccess: false,
    }
  });

  const handleViewContact = (contact: Contact) => {
    setSelectedContact(contact);
    setIsDetailModalOpen(true);
  };

  const handleEditContact = (contact: Contact) => {
    setSelectedContact(contact);
    editForm.reset({
      netsuiteInternalId: contact.netsuite_internal_id,
      name: contact.name,
      jobTitle: contact.job_title || "",
      phone: contact.phone || "",
      email: contact.email || "",
      inactive: contact.inactive,
      duplicate: contact.duplicate,
      loginAccess: contact.login_access,
    });
    setIsEditModalOpen(true);
  };

  const handleDeleteContact = (contact: Contact) => {
    setContactToDelete(contact);
    setIsDeleteDialogOpen(true);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handleSearch = (term: string) => {
    setSearchTerm(term);
    setCurrentPage(1); // Reset to first page
  };

  const handleFilterChange = (filter: string, value: string) => {
    if (filter === 'status') setStatusFilter(value);
    if (filter === 'verification') setVerificationFilter(value);
    setCurrentPage(1); // Reset to first page
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    return new Date(dateString).toLocaleDateString();
  };

  const formatVerificationMethod = (method: string | null) => {
    if (!method) return "Not verified";
    return method.replace(/_/g, ' ').toUpperCase();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-sm text-muted-foreground">Loading contacts...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Contact Directory</h1>
        <p className="text-muted-foreground">
          Manage and view contact information from your business network
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="text-sm font-medium">Total Contacts</div>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total?.toLocaleString() || '0'}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="text-sm font-medium">Verified Contacts</div>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {stats?.verified?.toLocaleString() || '0'}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="text-sm font-medium">Active Contacts</div>
            <User className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {stats?.active?.toLocaleString() || '0'}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="text-sm font-medium">With Email</div>
            <Mail className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {stats?.withEmail?.toLocaleString() || '0'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Search & Filter Contacts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search by name, email, or job title..."
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                className="max-w-sm"
              />
            </div>
            
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={(value) => handleFilterChange('status', value)}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={verificationFilter} onValueChange={(value) => handleFilterChange('verification', value)}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Verification" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Contacts</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="unverified">Unverified</SelectItem>
                </SelectContent>
              </Select>

              <Button 
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Contact
              </Button>
            </div>
          </div>
          
          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <span>
              Showing {contacts.length} of {pagination?.total?.toLocaleString() || 0} contacts
            </span>
            
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                
                <span className="text-sm">
                  Page {currentPage} of {pagination.totalPages}
                </span>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= pagination.totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Contacts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Contact Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Job Title</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact: Contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">{contact.name}</TableCell>
                  <TableCell>
                    {contact.email ? (
                      <span className="text-blue-600">{contact.email}</span>
                    ) : (
                      <span className="text-muted-foreground">No email</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {contact.company ? (
                      <span className="text-sm text-green-700">{contact.company}</span>
                    ) : (
                      <span className="text-muted-foreground">No company</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {contact.job_title || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>
                    {contact.phone || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={contact.inactive ? "destructive" : "default"}>
                      {contact.inactive ? "Inactive" : "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {contact.verified ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="text-sm">
                        {contact.verified ? "Verified" : "Unverified"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewContact(contact)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditContact(contact)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      
                      {contact.inactive ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reactivateMutation.mutate(contact.id)}
                          disabled={reactivateMutation.isPending}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteContact(contact)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {contacts.length === 0 && !isLoading && (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No contacts found matching your criteria</p>
            </div>
          )}

          {isLoading && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading contacts...</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Contact Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Contact</DialogTitle>
          </DialogHeader>
          
          <Form {...createForm}>
            <form 
              onSubmit={createForm.handleSubmit((data) => createMutation.mutate(data))}
              className="space-y-4"
            >
              <FormField
                control={createForm.control}
                name="netsuiteInternalId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>NetSuite ID *</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter NetSuite internal ID" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter contact name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={createForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter email address" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={createForm.control}
                name="jobTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Job Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter job title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={createForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter phone number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Creating..." : "Create Contact"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Contact Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
          </DialogHeader>
          
          <Form {...editForm}>
            <form 
              onSubmit={editForm.handleSubmit((data) => {
                if (selectedContact) {
                  updateMutation.mutate({ id: selectedContact.id, data });
                }
              })}
              className="space-y-4"
            >
              <FormField
                control={editForm.control}
                name="netsuiteInternalId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>NetSuite ID *</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter NetSuite internal ID" {...field} disabled />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter contact name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={editForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter email address" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={editForm.control}
                name="jobTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Job Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter job title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={editForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter phone number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? "Updating..." : "Update Contact"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate "{contactToDelete?.name}"? 
              This will mark the contact as inactive but preserve the record for historical purposes.
              You can reactivate the contact later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (contactToDelete) {
                  deleteMutation.mutate(contactToDelete.id);
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deactivating..." : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Contact Detail Modal */}
      <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Contact Details</DialogTitle>
          </DialogHeader>
          
          {selectedContact && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Name</label>
                <p className="text-lg font-semibold">{selectedContact.name}</p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-muted-foreground">NetSuite ID</label>
                <p className="font-mono text-sm">{selectedContact.netsuite_internal_id}</p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-muted-foreground">Email</label>
                <p className="text-blue-600">{selectedContact.email || "No email"}</p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-muted-foreground">Job Title</label>
                <p>{selectedContact.job_title || "Not specified"}</p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-muted-foreground">Phone</label>
                <p>{selectedContact.phone || "Not specified"}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Status</label>
                  <Badge variant={selectedContact.inactive ? "destructive" : "default"}>
                    {selectedContact.inactive ? "Inactive" : "Active"}
                  </Badge>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Login Access</label>
                  <Badge variant={selectedContact.login_access ? "default" : "secondary"}>
                    {selectedContact.login_access ? "Yes" : "No"}
                  </Badge>
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium text-muted-foreground">Verification</label>
                <div className="flex items-center gap-2 mt-1">
                  {selectedContact.verified ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span>{selectedContact.verified ? "Verified" : "Unverified"}</span>
                </div>
                {selectedContact.verified && (
                  <>
                    <p className="text-sm text-muted-foreground mt-1">
                      Method: {formatVerificationMethod(selectedContact.last_verified_method)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Last verified: {formatDate(selectedContact.last_verified_at)}
                    </p>
                    {selectedContact.verification_confidence && (
                      <p className="text-sm text-muted-foreground">
                        Confidence: {(selectedContact.verification_confidence * 100).toFixed(1)}%
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}