import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Item, InsertItem, UpdateItem } from "@shared/schema";

interface ItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  item?: Item;
  mode: "create" | "edit";
}

export function ItemFormModal({ isOpen, onClose, item, mode }: ItemFormModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState<Partial<InsertItem>>(() => ({
    netsuiteId: item?.netsuiteId || "",
    finalSku: item?.finalSku || "",
    displayName: item?.displayName || "",
    subType: item?.subType || "",
    description: item?.description || "",
    basePrice: item?.basePrice || "",
    taxSchedule: item?.taxSchedule || "",
    planner: item?.planner || "",
    isActive: item?.isActive ?? true,
  }));

  // Update form data when item prop changes
  useEffect(() => {
    if (isOpen) {
      setFormData({
        netsuiteId: item?.netsuiteId || "",
        finalSku: item?.finalSku || "",
        displayName: item?.displayName || "",
        subType: item?.subType || "",
        description: item?.description || "",
        basePrice: item?.basePrice || "",
        taxSchedule: item?.taxSchedule || "",
        planner: item?.planner || "",
        isActive: item?.isActive ?? true,
      });
    }
  }, [item, isOpen, mode]);

  const createMutation = useMutation({
    mutationFn: async (data: InsertItem) => {
      const response = await fetch("/api/items", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { 
          "Content-Type": "application/json",
          "user-role": "admin" // For demo purposes - in real app, this would come from auth
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create item");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items/stats"] });
      toast({
        title: "Success",
        description: "Item created successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create item",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<UpdateItem>) => {
      const response = await fetch(`/api/items/${item?.id}`, {
        method: "PUT",
        body: JSON.stringify(data),
        headers: { 
          "Content-Type": "application/json",
          "user-role": "admin" // For demo purposes - in real app, this would come from auth
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update item");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items/stats"] });
      toast({
        title: "Success",
        description: "Item updated successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update item",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Basic validation
    if (!formData.finalSku || !formData.displayName) {
      toast({
        title: "Validation Error",
        description: "Final SKU and Display Name are required",
        variant: "destructive",
      });
      return;
    }

    if (mode === "create") {
      createMutation.mutate(formData as InsertItem);
    } else {
      updateMutation.mutate(formData);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create New Item" : "Edit Item"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="finalSku">Final SKU *</Label>
              <Input
                id="finalSku"
                value={formData.finalSku || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, finalSku: e.target.value }))}
                placeholder="SKU123"
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
            <Label htmlFor="displayName">Display Name *</Label>
            <Input
              id="displayName"
              value={formData.displayName || ""}
              onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
              placeholder="Item Display Name"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="subType">Sub Type</Label>
              <Input
                id="subType"
                value={formData.subType || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, subType: e.target.value }))}
                placeholder="Category/Type"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="basePrice">Base Price</Label>
              <Input
                id="basePrice"
                value={formData.basePrice || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, basePrice: e.target.value }))}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description || ""}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Item description..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="taxSchedule">Tax Schedule</Label>
              <Input
                id="taxSchedule"
                value={formData.taxSchedule || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, taxSchedule: e.target.value }))}
                placeholder="Tax schedule"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="planner">Planner</Label>
              <Input
                id="planner"
                value={formData.planner || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, planner: e.target.value }))}
                placeholder="Planner name"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="isActive"
              checked={formData.isActive}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isActive: checked }))}
            />
            <Label htmlFor="isActive">Active</Label>
          </div>

          <div className="flex justify-end space-x-3 pt-6">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading}
            >
              {isLoading ? "Saving..." : mode === "create" ? "Create Item" : "Update Item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}