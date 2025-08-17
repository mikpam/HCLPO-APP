import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { Customer } from "@shared/schema";

interface DeleteCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer | null;
}

export function DeleteCustomerModal({ isOpen, onClose, customer }: DeleteCustomerModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/customers/${customer?.id}`, {
        method: "DELETE",
        headers: { 
          "user-role": "admin" // For demo purposes - in real app, this would come from auth
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to deactivate customer");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({
        title: "Success",
        description: "Customer deactivated successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to deactivate customer",
        variant: "destructive",
      });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/customers/${customer?.id}/reactivate`, {
        method: "PATCH",
        headers: { 
          "user-role": "admin" // For demo purposes - in real app, this would come from auth
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to reactivate customer");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({
        title: "Success",
        description: "Customer reactivated successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reactivate customer",
        variant: "destructive",
      });
    },
  });

  const handleDelete = () => {
    if (customer?.isActive) {
      deleteMutation.mutate();
    } else {
      reactivateMutation.mutate();
    }
  };

  const isLoading = deleteMutation.isPending || reactivateMutation.isPending;

  if (!customer) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {customer.isActive ? "Deactivate Customer" : "Reactivate Customer"}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-gray-600 mb-4">
            {customer.isActive 
              ? "Are you sure you want to deactivate this customer? This will hide them from active searches but preserve historical data."
              : "Are you sure you want to reactivate this customer? They will appear in active searches again."
            }
          </p>
          
          <div className="bg-gray-50 p-3 rounded border">
            <p className="font-medium">{customer.companyName}</p>
            <p className="text-sm text-gray-600">Customer Number: {customer.customerNumber}</p>
            <p className="text-sm text-gray-600">
              Current Status: 
              <span className={`ml-1 font-medium ${customer.isActive ? 'text-green-600' : 'text-red-600'}`}>
                {customer.isActive ? 'Active' : 'Inactive'}
              </span>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button 
            variant={customer.isActive ? "destructive" : "default"}
            onClick={handleDelete}
            disabled={isLoading}
          >
            {isLoading 
              ? "Processing..." 
              : customer.isActive 
                ? "Deactivate Customer" 
                : "Reactivate Customer"
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}