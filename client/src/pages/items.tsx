import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Search, 
  Plus, 
  Edit2, 
  Power, 
  Package,
  DollarSign,
  CheckCircle,
  XCircle
} from "lucide-react";
import { ItemFormModal } from "@/components/items/ItemFormModal";
import { DeleteItemModal } from "@/components/items/DeleteItemModal";
import type { Item } from "@shared/schema";

interface ItemsResponse {
  items: Item[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface ItemStats {
  total: number;
  active: number;
  inactive: number;
}

export default function ItemsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState("displayName");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);

  // Fetch items with pagination and search
  const { data: itemsData, isLoading } = useQuery<ItemsResponse>({
    queryKey: ["/api/items", currentPage, searchTerm, sortBy, sortOrder],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: "50000",
        search: searchTerm,
        sortBy,
        sortOrder,
      });
      const response = await fetch(`/api/items?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch items");
      }
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch item statistics
  const { data: stats } = useQuery<ItemStats>({
    queryKey: ["/api/items/stats"],
    refetchInterval: 30000,
  });

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
    setCurrentPage(1);
  };

  const handleEdit = (item: Item) => {
    setSelectedItem(item);
    setShowEditModal(true);
  };

  const handleDelete = (item: Item) => {
    setSelectedItem(item);
    setShowDeleteModal(true);
  };

  const handleCreateNew = () => {
    setSelectedItem(null);
    setShowCreateModal(true);
  };

  const items = itemsData?.items || [];
  const pagination = itemsData?.pagination;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Items Management</h1>
            <p className="text-muted-foreground">
              Manage your product catalog and inventory items
            </p>
          </div>
          <Button onClick={handleCreateNew} className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Create Item
          </Button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Items</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">
                  Complete product catalog
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Items</CardTitle>
                <CheckCircle className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{stats.active.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">
                  Available for orders
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Inactive Items</CardTitle>
                <XCircle className="h-4 w-4 text-gray-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-500">{stats.inactive.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">
                  Not available for orders
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Search and Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Search & Filter</CardTitle>
            <CardDescription>
              Find items by SKU, name, or description
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="displayName">Display Name</SelectItem>
                  <SelectItem value="finalSku">SKU</SelectItem>
                  <SelectItem value="netsuiteId">NetSuite ID</SelectItem>
                  <SelectItem value="basePrice">Base Price</SelectItem>
                  <SelectItem value="isActive">Status</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortOrder} onValueChange={(value: "asc" | "desc") => setSortOrder(value)}>
                <SelectTrigger className="w-full sm:w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">Ascending</SelectItem>
                  <SelectItem value="desc">Descending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Items Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle>Items List</CardTitle>
                <CardDescription>
                  {pagination ? `Showing ${items.length} of ${pagination.total} items` : 'Loading items...'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center h-32">
                <div className="text-muted-foreground">Loading items...</div>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <Package className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No items found</p>
                {searchTerm && (
                  <p className="text-sm text-muted-foreground">
                    Try adjusting your search criteria
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleSort("finalSku")}
                        >
                          Final SKU {sortBy === "finalSku" && (sortOrder === "asc" ? "↑" : "↓")}
                        </TableHead>
                        <TableHead 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleSort("displayName")}
                        >
                          Display Name {sortBy === "displayName" && (sortOrder === "asc" ? "↑" : "↓")}
                        </TableHead>
                        <TableHead>Sub Type</TableHead>
                        <TableHead>Base Price</TableHead>
                        <TableHead>NetSuite ID</TableHead>
                        <TableHead 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleSort("isActive")}
                        >
                          Status {sortBy === "isActive" && (sortOrder === "asc" ? "↑" : "↓")}
                        </TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={item.id} className="hover:bg-muted/50">
                          <TableCell className="font-medium">
                            {item.finalSku}
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">{item.displayName}</div>
                              {item.description && (
                                <div className="text-sm text-muted-foreground truncate max-w-xs">
                                  {item.description}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{item.subType || "-"}</TableCell>
                          <TableCell>
                            {item.basePrice ? (
                              <span className="font-medium">${item.basePrice}</span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            {item.netsuiteId || "-"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={item.isActive ? "default" : "secondary"}>
                              {item.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEdit(item)}
                                className="h-8 w-8 p-0"
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(item)}
                                className="h-8 w-8 p-0"
                              >
                                <Power className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Modals */}
        <ItemFormModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          mode="create"
        />
        
        <ItemFormModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          item={selectedItem || undefined}
          mode="edit"
        />
        
        <DeleteItemModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          item={selectedItem}
        />
      </div>
    </div>
  );
}