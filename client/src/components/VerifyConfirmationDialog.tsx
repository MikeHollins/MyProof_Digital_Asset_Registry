import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface FreshProofParams {
  requireFreshProof: boolean;
  proof_uri?: string;
  proof_bytes?: string;
}

interface VerifyConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (freshProofParams: FreshProofParams) => void;
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
  const [requireFreshProof, setRequireFreshProof] = useState(false);
  const [proofSourceType, setProofSourceType] = useState<"uri" | "bytes">("uri");
  const [proofUri, setProofUri] = useState("");
  const [proofBytes, setProofBytes] = useState("");

  const handleConfirm = () => {
    const freshProofParams: FreshProofParams = {
      requireFreshProof,
      proof_uri: requireFreshProof && proofSourceType === "uri" ? proofUri : undefined,
      proof_bytes: requireFreshProof && proofSourceType === "bytes" ? proofBytes : undefined,
    };
    onConfirm(freshProofParams);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setRequireFreshProof(false);
      setProofSourceType("uri");
      setProofUri("");
      setProofBytes("");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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

        <div className="space-y-4 py-4">
          <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground">
            <li>Execute cryptographic signature verification</li>
            <li>Validate proof structure and format</li>
            <li>Extract and store verification metadata</li>
            <li>Update the verification timestamp</li>
            <li>Create an audit log entry</li>
          </ul>

          <div className="p-3 bg-muted rounded-md">
            <p className="text-xs text-muted-foreground font-mono break-all">
              <span className="font-semibold">Proof ID:</span> {proofId}
            </p>
          </div>

          {/* Fresh Proof Controls */}
          <div className="border-t border-border pt-4 space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="require-fresh-proof"
                checked={requireFreshProof}
                onCheckedChange={(checked) => setRequireFreshProof(checked as boolean)}
                data-testid="checkbox-require-fresh-proof"
              />
              <Label htmlFor="require-fresh-proof" className="text-sm font-medium cursor-pointer">
                Require Fresh Proof
              </Label>
            </div>

            {requireFreshProof && (
              <div className="space-y-4 ml-6 p-4 bg-muted/50 rounded-md">
                <Label className="text-sm font-medium">Proof Source</Label>
                <RadioGroup
                  value={proofSourceType}
                  onValueChange={(value) => setProofSourceType(value as "uri" | "bytes")}
                  data-testid="radio-proof-source"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="uri" id="proof-uri-option" data-testid="radio-proof-uri" />
                    <Label htmlFor="proof-uri-option" className="cursor-pointer">
                      Proof URI (HTTPS)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="bytes" id="proof-bytes-option" data-testid="radio-proof-bytes" />
                    <Label htmlFor="proof-bytes-option" className="cursor-pointer">
                      Proof Bytes (base64url)
                    </Label>
                  </div>
                </RadioGroup>

                {proofSourceType === "uri" ? (
                  <div className="space-y-2">
                    <Label htmlFor="proof-uri" className="text-sm">
                      Proof URI <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="proof-uri"
                      type="url"
                      placeholder="https://example.com/proof.jws"
                      value={proofUri}
                      onChange={(e) => setProofUri(e.target.value)}
                      className="font-mono text-sm"
                      data-testid="input-proof-uri"
                    />
                    <p className="text-xs text-muted-foreground">
                      Must be an HTTPS URL pointing to the proof artifact
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="proof-bytes" className="text-sm">
                      Proof Bytes <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="proof-bytes"
                      placeholder="base64url-encoded proof data"
                      value={proofBytes}
                      onChange={(e) => setProofBytes(e.target.value)}
                      className="font-mono text-sm min-h-[100px]"
                      data-testid="textarea-proof-bytes"
                    />
                    <p className="text-xs text-muted-foreground">
                      Base64url-encoded proof bytes
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isVerifying}
            data-testid="button-cancel-verify"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={handleConfirm}
            disabled={isVerifying || (requireFreshProof && !proofUri && !proofBytes)}
            data-testid="button-confirm-verify"
          >
            {isVerifying ? "Verifying..." : "Verify Proof"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
