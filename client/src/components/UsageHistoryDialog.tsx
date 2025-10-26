import { useQuery } from "@tanstack/react-query";
import { Activity, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Usage {
  usageId: string;
  assetId: string;
  usedAt: string;
}

interface UsageHistoryDialogProps {
  proofAssetId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UsageHistoryDialog({
  proofAssetId,
  open,
  onOpenChange,
}: UsageHistoryDialogProps) {
  const { data: response, isLoading } = useQuery<{ usages: Usage[]; total_uses: number }>({
    queryKey: ['/api/proof-assets', proofAssetId, 'usage'],
    enabled: !!proofAssetId && open,
  });

  const usages = response?.usages;
  const totalUses = response?.total_uses || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-usage-history">
        <DialogHeader>
          <DialogTitle>Usage History</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {proofAssetId && (
            <div className="p-3 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground font-mono break-all">
                <span className="font-semibold">Asset ID:</span> {proofAssetId}
              </p>
            </div>
          )}

          <ScrollArea className="h-[400px] pr-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                Loading usage history...
              </div>
            ) : !usages || usages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <Activity className="h-12 w-12 mb-2 opacity-50" />
                <p>No usage history</p>
                <p className="text-xs">This asset has not been used</p>
              </div>
            ) : (
              <div className="space-y-2">
                {usages.map((usage, idx) => (
                  <div
                    key={usage.usageId}
                    className="flex items-center justify-between p-3 border border-border rounded-md hover-elevate"
                    data-testid={`usage-item-${usage.usageId}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          Usage Event #{usages.length - idx}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          ID: {usage.usageId.slice(0, 16)}...
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-foreground">
                        {new Date(usage.usedAt).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(usage.usedAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {usages && usages.length > 0 && (
            <div className="border-t border-border pt-3 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Total Usage Events: <span className="font-medium text-foreground">{totalUses}</span>
              </p>
              {usages.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Last used: {new Date(usages[usages.length - 1].usedAt).toLocaleDateString()}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
