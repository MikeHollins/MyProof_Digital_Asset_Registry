import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Transfer {
  transferId: string;
  assetId: string;
  fromDid: string;
  toDid: string;
  createdAt: string;
}

interface TransferHistoryDialogProps {
  proofAssetId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TransferHistoryDialog({
  proofAssetId,
  open,
  onOpenChange,
}: TransferHistoryDialogProps) {
  const { data: response, isLoading } = useQuery<{ transfers: Transfer[] }>({
    queryKey: ['/api/proof-assets', proofAssetId, 'transfers'],
    enabled: !!proofAssetId && open,
  });

  const transfers = response?.transfers;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="dialog-transfer-history">
        <DialogHeader>
          <DialogTitle>Transfer History</DialogTitle>
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
                Loading transfer history...
              </div>
            ) : !transfers || transfers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <Clock className="h-12 w-12 mb-2 opacity-50" />
                <p>No transfer history</p>
                <p className="text-xs">This asset has not been transferred</p>
              </div>
            ) : (
              <div className="space-y-4">
                {transfers.map((transfer, idx) => (
                  <div
                    key={transfer.transferId}
                    className="border border-border rounded-md p-4 space-y-3"
                    data-testid={`transfer-item-${transfer.transferId}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Transfer #{transfers.length - idx}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(transfer.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">From</p>
                        <code
                          className="block text-sm font-mono text-foreground break-all"
                          data-testid={`transfer-from-did-${transfer.transferId}`}
                        >
                          {transfer.fromDid}
                        </code>
                      </div>

                      <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />

                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">To</p>
                        <code
                          className="block text-sm font-mono text-foreground break-all"
                          data-testid={`transfer-to-did-${transfer.transferId}`}
                        >
                          {transfer.toDid}
                        </code>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {transfers && transfers.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="text-sm text-muted-foreground">
                Total Transfers: <span className="font-medium text-foreground">{transfers.length}</span>
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
