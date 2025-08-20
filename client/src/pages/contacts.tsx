import { useState, useMemo } from "react";
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
  User, 
  Phone, 
  Mail, 
  Eye,
  Filter,
  Download,
  CheckCircle,
  XCircle,
  Calendar
} from "lucide-react";

// Contact interface based on the schema
interface Contact {
  id: string;
  netsuite_internal_id: string;
  name: string;
  job_title: string | null;
  phone: string | null;
  email: string | null;
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

export default function ContactsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [verificationFilter, setVerificationFilter] = useState<string>("all");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['/api/contacts'],
    queryFn: async () => {
      const response = await fetch('/api/contacts');
      if (!response.ok) {
        throw new Error('Failed to fetch contacts');
      }
      return response.json();
    }
  });

  // Filter contacts based on search and filters
  const filteredContacts = useMemo(() => {
    return contacts.filter((contact: Contact) => {
      const matchesSearch = searchTerm === "" || 
        contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (contact.email && contact.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (contact.job_title && contact.job_title.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesStatus = statusFilter === "all" || 
        (statusFilter === "active" && !contact.inactive) ||
        (statusFilter === "inactive" && contact.inactive);

      const matchesVerification = verificationFilter === "all" ||
        (verificationFilter === "verified" && contact.verified) ||
        (verificationFilter === "unverified" && !contact.verified);

      return matchesSearch && matchesStatus && matchesVerification;
    });
  }, [contacts, searchTerm, statusFilter, verificationFilter]);

  const handleViewContact = (contact: Contact) => {
    setSelectedContact(contact);
    setIsDetailModalOpen(true);
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
            <div className="text-2xl font-bold">{contacts.length.toLocaleString()}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="text-sm font-medium">Verified Contacts</div>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {contacts.filter((c: Contact) => c.verified).length.toLocaleString()}
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
              {contacts.filter((c: Contact) => !c.inactive).length.toLocaleString()}
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
              {contacts.filter((c: Contact) => c.email).length.toLocaleString()}
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
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
              />
            </div>
            
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={verificationFilter} onValueChange={setVerificationFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Verification" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Contacts</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="unverified">Unverified</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="text-sm text-muted-foreground">
            Showing {filteredContacts.length} of {contacts.length} contacts
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
                <TableHead>Job Title</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredContacts.map((contact: Contact) => (
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewContact(contact)}
                    >
                      <Eye className="h-4 w-4" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {filteredContacts.length === 0 && (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No contacts found matching your criteria</p>
            </div>
          )}
        </CardContent>
      </Card>

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