import { Download, Copy, Check } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ProofFormatBadge } from "./ProofFormatBadge";
import { StatusBadge } from "./StatusBadge";
import { CidDisplay } from "./CidDisplay";
import type { ProofAsset } from "@shared/schema";

interface ProofDetailsDialogProps {
  proof: ProofAsset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProofDetailsDialog({
  proof,
  open,
  onOpenChange,
}: ProofDetailsDialogProps) {
  const [copied, setCopied] = useState(false);

  if (!proof) return null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const jsonString = JSON.stringify(proof, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `proof-${proof.proofAssetId}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const metadata = proof.verificationMetadata as any;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Proof Asset Details
            <ProofFormatBadge format={proof.proofFormat as any} />
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-180px)] pr-4">
          <div className="space-y-6">
            {/* Core Identity */}
            <section>
              <h3 className="text-sm font-semibold mb-3">Core Identity</h3>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Proof Asset ID</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md">
                      {proof.proofAssetId}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCopy(proof.proofAssetId)}
                      data-testid="button-copy-id"
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Proof Commitment (CID)</Label>
                  <CidDisplay value={proof.proofAssetCommitment} truncateLength={999} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Created</Label>
                    <p className="text-sm mt-1">
                      {new Date(proof.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Last Updated</Label>
                    <p className="text-sm mt-1">
                      {new Date(proof.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <Separator />

            {/* Verification Status */}
            <section>
              <h3 className="text-sm font-semibold mb-3">Verification Status</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <StatusBadge status={proof.verificationStatus as any} />
                </div>

                {proof.verificationAlgorithm && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Algorithm</Label>
                    <Badge variant="outline" className="mt-1">
                      {proof.verificationAlgorithm}
                    </Badge>
                  </div>
                )}

                {proof.verificationPublicKeyDigest && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Public Key Digest (SHA-256)</Label>
                    <code className="block text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 break-all">
                      {proof.verificationPublicKeyDigest}
                    </code>
                  </div>
                )}

                {proof.verificationTimestamp && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Verified At</Label>
                    <p className="text-sm mt-1">
                      {new Date(proof.verificationTimestamp).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Derived Facts (from verification metadata) */}
            {metadata && (
              <>
                <Separator />
                <section>
                  <h3 className="text-sm font-semibold mb-3">Derived Facts</h3>
                  <div className="space-y-3">
                    {metadata.issuer && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Issuer</Label>
                        <code className="block text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 break-all">
                          {metadata.issuer}
                        </code>
                      </div>
                    )}

                    {metadata.subject && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Subject</Label>
                        <code className="block text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 break-all">
                          {metadata.subject}
                        </code>
                      </div>
                    )}

                    {metadata.audience && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Audience</Label>
                        <code className="block text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 break-all">
                          {metadata.audience}
                        </code>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      {metadata.issuedAt && (
                        <div>
                          <Label className="text-xs text-muted-foreground">Issued At</Label>
                          <p className="text-sm mt-1">
                            {new Date(metadata.issuedAt).toLocaleString()}
                          </p>
                        </div>
                      )}

                      {metadata.expiresAt && (
                        <div>
                          <Label className="text-xs text-muted-foreground">Expires At</Label>
                          <p className="text-sm mt-1">
                            {new Date(metadata.expiresAt).toLocaleString()}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </>
            )}

            <Separator />

            {/* DIDs and Bindings */}
            <section>
              <h3 className="text-sm font-semibold mb-3">DIDs & Bindings</h3>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Issuer DID</Label>
                  <code className="block text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 break-all">
                    {proof.issuerDid}
                  </code>
                </div>

                {proof.subjectBinding && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Subject Binding</Label>
                    <code className="block text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 break-all">
                      {proof.subjectBinding}
                    </code>
                  </div>
                )}
              </div>
            </section>

            <Separator />

            {/* Proof Content */}
            <section>
              <h3 className="text-sm font-semibold mb-3">Proof Content</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Format</Label>
                    <ProofFormatBadge format={proof.proofFormat as any} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Digest Algorithm</Label>
                    <Badge variant="outline" className="mt-1">{proof.digestAlg}</Badge>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Proof Digest</Label>
                  <code className="block text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 break-all">
                    {proof.proofDigest}
                  </code>
                </div>

                {proof.proofUri && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Proof URI / Data</Label>
                    <code className="block text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 break-all max-h-32 overflow-y-auto">
                      {proof.proofUri}
                    </code>
                  </div>
                )}
              </div>
            </section>

            <Separator />

            {/* Policy & Constraints */}
            <section>
              <h3 className="text-sm font-semibold mb-3">Policy & Constraints</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Policy Hash</Label>
                    <code className="block text-xs font-mono bg-muted px-2 py-1.5 rounded-md mt-1 break-all text-[10px]">
                      {proof.policyHash}
                    </code>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Constraint Hash</Label>
                    <code className="block text-xs font-mono bg-muted px-2 py-1.5 rounded-md mt-1 break-all text-[10px]">
                      {proof.constraintHash}
                    </code>
                  </div>
                </div>

                {proof.policyCid && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Policy CID</Label>
                    <CidDisplay value={proof.policyCid} truncateLength={999} />
                  </div>
                )}

                {proof.constraintCid && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Constraint CID</Label>
                    <CidDisplay value={proof.constraintCid} truncateLength={999} />
                  </div>
                )}
              </div>
            </section>

            <Separator />

            {/* W3C Status List */}
            <section>
              <h3 className="text-sm font-semibold mb-3">W3C Status List</h3>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Status List URL</Label>
                  <code className="block text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 break-all">
                    {proof.statusListUrl}
                  </code>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Status Index</Label>
                    <p className="text-sm font-mono mt-1">{proof.statusListIndex}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Status Purpose</Label>
                    <Badge variant="outline" className="mt-1">{proof.statusPurpose}</Badge>
                  </div>
                </div>
              </div>
            </section>

            {/* Optional Fields */}
            {(proof.circuitOrSchemaId || proof.circuitCid || proof.schemaCid || proof.contentCids || proof.auditCid) && (
              <>
                <Separator />
                <section>
                  <h3 className="text-sm font-semibold mb-3">Additional References</h3>
                  <div className="space-y-3">
                    {proof.circuitOrSchemaId && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Circuit/Schema ID</Label>
                        <code className="block text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 break-all">
                          {proof.circuitOrSchemaId}
                        </code>
                      </div>
                    )}

                    {proof.circuitCid && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Circuit CID</Label>
                        <CidDisplay value={proof.circuitCid} truncateLength={999} />
                      </div>
                    )}

                    {proof.schemaCid && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Schema CID</Label>
                        <CidDisplay value={proof.schemaCid} truncateLength={999} />
                      </div>
                    )}

                    {proof.contentCids && proof.contentCids.length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Content CIDs</Label>
                        <div className="space-y-1 mt-1">
                          {proof.contentCids.map((cid, idx) => (
                            <CidDisplay key={idx} value={cid} truncateLength={999} />
                          ))}
                        </div>
                      </div>
                    )}

                    {proof.auditCid && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Audit CID</Label>
                        <CidDisplay value={proof.auditCid} truncateLength={999} />
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}

            {/* Attestations & License */}
            {(proof.attestations || proof.license) && (
              <>
                <Separator />
                <section>
                  <h3 className="text-sm font-semibold mb-3">Metadata</h3>
                  <div className="space-y-3">
                    {proof.attestations && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Attestations</Label>
                        <pre className="text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 overflow-x-auto">
                          {JSON.stringify(proof.attestations as any, null, 2)}
                        </pre>
                      </div>
                    )}

                    {proof.license && (
                      <div>
                        <Label className="text-xs text-muted-foreground">License</Label>
                        <pre className="text-xs font-mono bg-muted px-3 py-2 rounded-md mt-1 overflow-x-auto">
                          {JSON.stringify(proof.license as any, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            data-testid="button-export-json"
          >
            <Download className="h-4 w-4 mr-2" />
            Export JSON
          </Button>
          <Button
            variant="default"
            onClick={() => onOpenChange(false)}
            data-testid="button-close-details"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
