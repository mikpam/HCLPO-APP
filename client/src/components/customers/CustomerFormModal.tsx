import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { Customer, InsertCustomer, UpdateCustomer } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { X, Plus } from "lucide-react";

interface CustomerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer?: Customer;
  mode: "create" | "edit";
}

export function CustomerFormModal({ isOpen, onClose, customer, mode }: CustomerFormModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState<Partial<InsertCustomer>>(() => ({
    customerNumber: customer?.customerNumber || "",
    companyName: customer?.companyName || "",
    email: customer?.email || "",
    phone: customer?.phone || "",
    netsuiteId: customer?.netsuiteId || "",
    isActive: customer?.isActive ?? true,
    alternateNames: customer?.alternateNames || [],
  }));

  const [newAlternateName, setNewAlternateName] = useState("");

  // Update form data when customer prop changes
  useEffect(() => {
    if (isOpen) {
      setFormData({
        customerNumber: customer?.customerNumber || "",
        companyName: customer?.companyName || "",
        email: customer?.email || "",
        phone: customer?.phone || "",
        netsuiteId: customer?.netsuiteId || "",
        isActive: customer?.isActive ?? true,
        alternateNames: customer?.alternateNames || [],
      });
      setNewAlternateName("");
    }
  }, [customer, isOpen, mode]);

  const createMutation = useMutation({
    mutationFn: async (data: InsertCustomer) => {
      const response = await fetch("/api/customers", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { 
          "Content-Type": "application/json",
          "user-role": "admin" // For demo purposes - in real app, this would come from auth
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create customer");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({
        title: "Success",
        description: "Customer created successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create customer",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateCustomer) => {
      const response = await fetch(`/api/customers/${customer?.id}`, {
        method: "PUT",
        body: JSON.stringify(data),
        headers: { 
          "Content-Type": "application/json",
          "user-role": "admin" // For demo purposes - in real app, this would come from auth
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update customer");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({
        title: "Success",
        description: "Customer updated successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update customer",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Basic validation
    if (!formData.customerNumber || !formData.companyName) {
      toast({
        title: "Validation Error",
        description: "Customer number and company name are required",
        variant: "destructive",
      });
      return;
    }

    if (mode === "create") {
      createMutation.mutate(formData as InsertCustomer);
    } else {
      updateMutation.mutate(formData);
    }
  };

  const handleAddAlternateName = () => {
    if (newAlternateName.trim() && !formData.alternateNames?.includes(newAlternateName.trim())) {
      setFormData(prev => ({
        ...prev,
        alternateNames: [...(prev.alternateNames || []), newAlternateName.trim()]
      }));
      setNewAlternateName("");
    }
  };

  const handleRemoveAlternateName = (nameToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      alternateNames: prev.alternateNames?.filter(name => name !== nameToRemove) || []
    }));
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create New Customer" : "Edit Customer"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customerNumber">Customer Number *</Label>
              <Input
                id="customerNumber"
                value={formData.customerNumber || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, customerNumber: e.target.value }))}
                placeholder="C12345"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="netsuiteId">NetSuite ID</Label>
              <Input
                id="netsuiteId"
                value={formData.netsuiteId || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, netsuiteId: e.target.value }))}
                placeholder="12345"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="companyName">Company Name *</Label>
            <Input
              id="companyName"
              value={formData.companyName || ""}
              onChange={(e) => setFormData(prev => ({ ...prev, companyName: e.target.value }))}
              placeholder="Company Name"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="contact@company.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Alternate Names</Label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={newAlternateName}
                  onChange={(e) => setNewAlternateName(e.target.value)}
                  placeholder="Add alternate name"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddAlternateName())}
                />
                <Button type="button" variant="outline" size="sm" onClick={handleAddAlternateName}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              {formData.alternateNames && formData.alternateNames.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {formData.alternateNames.map((name, index) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {name}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-4 w-4 p-0 ml-1 hover:bg-transparent"
                        onClick={() => handleRemoveAlternateName(name)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="isActive"
              checked={formData.isActive ?? true}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isActive: checked }))}
            />
            <Label htmlFor="isActive">Active Customer</Label>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : mode === "create" ? "Create Customer" : "Update Customer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}