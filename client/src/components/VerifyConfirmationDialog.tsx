import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface VerifyConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isVerifying: boolean;
  proofId: string;
}

export function VerifyConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  isVerifying,
  proofId,
}: VerifyConfirmationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Confirm Re-Verification
          </DialogTitle>
          <DialogDescription className="pt-2">
            This will re-verify the proof asset and update its verification status.
            The verification process will:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4">
          <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground">
            <li>Execute cryptographic signature verification</li>
            <li>Validate proof structure and format</li>
            <li>Extract and store verification metadata</li>
            <li>Update the verification timestamp</li>
            <li>Create an audit log entry</li>
          </ul>

          <div className="mt-4 p-3 bg-muted rounded-md">
            <p className="text-xs text-muted-foreground font-mono break-all">
              <span className="font-semibold">Proof ID:</span> {proofId}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isVerifying}
            data-testid="button-cancel-verify"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={onConfirm}
            disabled={isVerifying}
            data-testid="button-confirm-verify"
          >
            {isVerifying ? "Verifying..." : "Verify Proof"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
