import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Item } from "@shared/schema";

interface DeleteItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: Item | null;
}

export function DeleteItemModal({ isOpen, onClose, item }: DeleteItemModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("No item selected");
      
      const response = await fetch(`/api/items/${item.id}`, {
        method: "DELETE",
        headers: { 
          "user-role": "admin" // For demo purposes - in real app, this would come from auth
        },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to deactivate item");
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items/stats"] });
      toast({
        title: "Success",
        description: "Item deactivated successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to deactivate item",
        variant: "destructive",
      });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("No item selected");
      
      const response = await fetch(`/api/items/${item.id}/activate`, {
        method: "POST",
        headers: { 
          "user-role": "admin" // For demo purposes - in real app, this would come from auth
        },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to reactivate item");
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items/stats"] });
      toast({
        title: "Success",
        description: "Item reactivated successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reactivate item",
        variant: "destructive",
      });
    },
  });

  const handleAction = () => {
    if (!item) return;
    
    if (item.isActive) {
      deactivateMutation.mutate();
    } else {
      reactivateMutation.mutate();
    }
  };

  const isLoading = deactivateMutation.isPending || reactivateMutation.isPending;

  if (!item) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {item.isActive ? "Deactivate Item" : "Reactivate Item"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-4 border rounded-lg bg-muted/50">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">SKU:</span>
                <span>{item.finalSku}</span>
                <Badge variant={item.isActive ? "default" : "secondary"}>
                  {item.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div>
                <span className="font-medium">Name:</span>
                <span className="ml-2">{item.displayName}</span>
              </div>
              {item.netsuiteId && (
                <div>
                  <span className="font-medium">NetSuite ID:</span>
                  <span className="ml-2">{item.netsuiteId}</span>
                </div>
              )}
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {item.isActive ? (
              <>
                This will deactivate the item. Deactivated items will not be available for new purchase orders 
                but existing orders will remain unaffected. You can reactivate the item later if needed.
              </>
            ) : (
              <>
                This will reactivate the item, making it available for new purchase orders again.
              </>
            )}
          </p>

          <div className="flex justify-end space-x-3">
            <Button 
              variant="outline" 
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button 
              variant={item.isActive ? "destructive" : "default"}
              onClick={handleAction}
              disabled={isLoading}
            >
              {isLoading ? "Processing..." : item.isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}