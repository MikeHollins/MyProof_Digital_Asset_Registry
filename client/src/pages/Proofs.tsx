import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Shield, Grid3x3, Table2, Filter, History, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { StatusBadge } from "@/components/StatusBadge";
import { ProofFormatBadge } from "@/components/ProofFormatBadge";
import { CidDisplay } from "@/components/CidDisplay";
import { VerificationDetails } from "@/components/VerificationDetails";
import { ProofDetailsDialog } from "@/components/ProofDetailsDialog";
import { VerifyConfirmationDialog, type FreshProofParams } from "@/components/VerifyConfirmationDialog";
import { TransferHistoryDialog } from "@/components/TransferHistoryDialog";
import { UsageHistoryDialog } from "@/components/UsageHistoryDialog";
import type { ProofAsset, InsertProofAsset } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ViewMode = "grid" | "table";

export default function Proofs() {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [didFilter, setDidFilter] = useState<string>("");
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [selectedProof, setSelectedProof] = useState<ProofAsset | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [isVerifyDialogOpen, setIsVerifyDialogOpen] = useState(false);
  const [proofToVerify, setProofToVerify] = useState<ProofAsset | null>(null);
  const [isTransferHistoryOpen, setIsTransferHistoryOpen] = useState(false);
  const [isUsageHistoryOpen, setIsUsageHistoryOpen] = useState(false);
  const [selectedProofForHistory, setSelectedProofForHistory] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    subjectDid: "",
    issuerDid: "",
    proofFormat: "JWS",
    contentCommitment: "",
    proofData: "",
  });
  
  const { toast } = useToast();

  const { data: proofs, isLoading } = useQuery<ProofAsset[]>({
    queryKey: ['/api/proof-assets'],
  });
  
  const registerMutation = useMutation({
    mutationFn: async (data: InsertProofAsset) => {
      const response = await apiRequest("POST", "/api/proof-assets", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/proof-assets'] });
      setIsRegisterModalOpen(false);
      setFormData({
        subjectDid: "",
        issuerDid: "",
        proofFormat: "JWS",
        contentCommitment: "",
        proofData: "",
      });
      toast({
        title: "Success",
        description: "Proof asset registered successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const verifyMutation = useMutation({
    mutationFn: async ({ proofId, freshProofParams }: { proofId: string; freshProofParams: FreshProofParams }) => {
      // Map frontend params to backend contract
      const payload: any = {};
      
      if (freshProofParams.requireFreshProof) {
        payload.requireFreshProof = true;
        if (freshProofParams.proof_uri) {
          payload.proof_uri = freshProofParams.proof_uri;
        }
        if (freshProofParams.proof_bytes) {
          payload.proof_bytes = freshProofParams.proof_bytes;
        }
      }
      
      const response = await apiRequest("POST", `/api/proof-assets/${proofId}/verify`, payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/proof-assets'] });
      setIsVerifyDialogOpen(false);
      setProofToVerify(null);
      toast({
        title: "Success",
        description: "Proof asset re-verified successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const payload: InsertProofAsset = {
      issuerDid: formData.issuerDid,
      proofFormat: formData.proofFormat as any,
      subjectBinding: formData.subjectDid,
      verifier_proof_ref: {
        proof_format: formData.proofFormat as any,
        proof_digest: formData.contentCommitment,
        digest_alg: "sha2-256",
        proof_uri: formData.proofData,
      },
      constraintHash: crypto.randomUUID(),
      policyHash: crypto.randomUUID(),
      policyCid: `baga${crypto.randomUUID().replace(/-/g, '')}`,
      digestAlg: "sha2-256",
      proofDigest: formData.contentCommitment,
    };
    
    registerMutation.mutate(payload);
  };

  const handleViewDetails = (proof: ProofAsset) => {
    setSelectedProof(proof);
    setIsDetailsDialogOpen(true);
  };

  const handleVerifyClick = (proof: ProofAsset) => {
    setProofToVerify(proof);
    setIsVerifyDialogOpen(true);
  };

  const handleConfirmVerify = (freshProofParams: FreshProofParams) => {
    if (proofToVerify) {
      verifyMutation.mutate({ 
        proofId: proofToVerify.proofAssetId,
        freshProofParams 
      });
    }
  };

  const handleViewTransferHistory = (proofAssetId: string) => {
    setSelectedProofForHistory(proofAssetId);
    setIsTransferHistoryOpen(true);
  };

  const handleViewUsageHistory = (proofAssetId: string) => {
    setSelectedProofForHistory(proofAssetId);
    setIsUsageHistoryOpen(true);
  };

  const filteredProofs = proofs?.filter((proof) => {
    if (formatFilter !== "all" && proof.proofFormat !== formatFilter) return false;
    if (statusFilter !== "all" && proof.verificationStatus !== statusFilter) return false;
    if (didFilter && !proof.issuerDid.toLowerCase().includes(didFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-semibold text-foreground">Proof Assets</h1>
          <p className="text-muted-foreground mt-2">
            Manage and explore registered cryptographic proofs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "grid" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("grid")}
            data-testid="button-view-grid"
          >
            <Grid3x3 className="h-4 w-4 mr-2" />
            Grid
          </Button>
          <Button
            variant={viewMode === "table" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("table")}
            data-testid="button-view-table"
          >
            <Table2 className="h-4 w-4 mr-2" />
            Table
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-medium">Filters</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="format-filter">Proof Format</Label>
              <Select value={formatFilter} onValueChange={setFormatFilter}>
                <SelectTrigger id="format-filter" data-testid="select-format-filter">
                  <SelectValue placeholder="All Formats" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Formats</SelectItem>
                  <SelectItem value="ZK_PROOF">ZK Proof</SelectItem>
                  <SelectItem value="JWS">JWS</SelectItem>
                  <SelectItem value="LD_PROOF">LD Proof</SelectItem>
                  <SelectItem value="HW_ATTESTATION">HW Attestation</SelectItem>
                  <SelectItem value="MERKLE_PROOF">Merkle Proof</SelectItem>
                  <SelectItem value="BLOCKCHAIN_TX_PROOF">Blockchain TX</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status-filter">Verification Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="status-filter" data-testid="select-status-filter">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="did-filter">Issuer DID</Label>
              <Input
                id="did-filter"
                placeholder="Search by DID..."
                value={didFilter}
                onChange={(e) => setDidFilter(e.target.value)}
                data-testid="input-did-filter"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">
          Loading proof assets...
        </div>
      ) : !filteredProofs || filteredProofs.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Shield className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No proofs found</h3>
            <p className="text-muted-foreground mb-6">
              {proofs && proofs.length > 0
                ? "Try adjusting your filters"
                : "Get started by registering your first proof"}
            </p>
            {(!proofs || proofs.length === 0) && (
              <Button 
                onClick={() => setIsRegisterModalOpen(true)}
                data-testid="button-register-proof"
              >
                Register New Proof
              </Button>
            )}
          </CardContent>
        </Card>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProofs.map((proof) => (
            <Card key={proof.proofAssetId} className="hover-elevate" data-testid={`card-proof-${proof.proofAssetId}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <ProofFormatBadge format={proof.proofFormat as any} />
                  <span className="text-xs text-muted-foreground">
                    {new Date(proof.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Proof ID</Label>
                  <CidDisplay value={proof.proofAssetId} truncateLength={20} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Digest</Label>
                  <CidDisplay value={proof.proofDigest} truncateLength={20} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Issuer DID</Label>
                  <code className="block text-xs font-mono text-muted-foreground mt-1">
                    {proof.issuerDid.slice(0, 32)}...
                  </code>
                </div>
                <div>
                  <VerificationDetails
                    status={proof.verificationStatus as any}
                    algorithm={proof.verificationAlgorithm}
                    publicKeyDigest={proof.verificationPublicKeyDigest}
                    timestamp={proof.verificationTimestamp}
                    metadata={proof.verificationMetadata}
                  />
                </div>
              </CardContent>
              <CardFooter className="pt-3 border-t border-card-border flex flex-col gap-2">
                <div className="flex gap-2 w-full">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1" 
                    onClick={() => handleViewDetails(proof)}
                    data-testid={`button-details-${proof.proofAssetId}`}
                  >
                    View Details
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={() => handleVerifyClick(proof)}
                    data-testid={`button-verify-${proof.proofAssetId}`}
                  >
                    Verify
                  </Button>
                </div>
                <div className="flex gap-2 w-full">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="flex-1"
                    onClick={() => handleViewTransferHistory(proof.proofAssetId)}
                    data-testid={`button-transfer-history-${proof.proofAssetId}`}
                  >
                    <History className="h-4 w-4 mr-1" />
                    Transfers
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="flex-1"
                    onClick={() => handleViewUsageHistory(proof.proofAssetId)}
                    data-testid={`button-usage-history-${proof.proofAssetId}`}
                  >
                    <Activity className="h-4 w-4 mr-1" />
                    Usage
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Proof ID
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Format
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Digest
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Issuer DID
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Created
                    </th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProofs.map((proof, idx) => (
                    <tr
                      key={proof.proofAssetId}
                      className={`border-b border-border last:border-0 hover-elevate ${
                        idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                      }`}
                      data-testid={`row-proof-${proof.proofAssetId}`}
                    >
                      <td className="p-4">
                        <CidDisplay value={proof.proofAssetId} truncateLength={16} />
                      </td>
                      <td className="p-4">
                        <ProofFormatBadge format={proof.proofFormat as any} />
                      </td>
                      <td className="p-4">
                        <CidDisplay value={proof.proofDigest} truncateLength={16} />
                      </td>
                      <td className="p-4">
                        <code className="text-sm font-mono text-muted-foreground">
                          {proof.issuerDid.slice(0, 24)}...
                        </code>
                      </td>
                      <td className="p-4">
                        <VerificationDetails
                          status={proof.verificationStatus as any}
                          algorithm={proof.verificationAlgorithm}
                          publicKeyDigest={proof.verificationPublicKeyDigest}
                          timestamp={proof.verificationTimestamp}
                          metadata={proof.verificationMetadata}
                        />
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {new Date(proof.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-1">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleViewDetails(proof)}
                            data-testid={`button-view-${proof.proofAssetId}`}
                          >
                            View
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleVerifyClick(proof)}
                            data-testid={`button-verify-${proof.proofAssetId}`}
                          >
                            Verify
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleViewTransferHistory(proof.proofAssetId)}
                            data-testid={`button-transfers-${proof.proofAssetId}`}
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleViewUsageHistory(proof.proofAssetId)}
                            data-testid={`button-usage-${proof.proofAssetId}`}
                          >
                            <Activity className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Proof Details Dialog */}
      <ProofDetailsDialog
        proof={selectedProof}
        open={isDetailsDialogOpen}
        onOpenChange={setIsDetailsDialogOpen}
      />

      {/* Verify Confirmation Dialog */}
      <VerifyConfirmationDialog
        open={isVerifyDialogOpen}
        onOpenChange={setIsVerifyDialogOpen}
        onConfirm={handleConfirmVerify}
        isVerifying={verifyMutation.isPending}
        proofId={proofToVerify?.proofAssetId || ""}
      />

      {/* Transfer History Dialog */}
      <TransferHistoryDialog
        proofAssetId={selectedProofForHistory}
        open={isTransferHistoryOpen}
        onOpenChange={setIsTransferHistoryOpen}
      />

      {/* Usage History Dialog */}
      <UsageHistoryDialog
        proofAssetId={selectedProofForHistory}
        open={isUsageHistoryOpen}
        onOpenChange={setIsUsageHistoryOpen}
      />

      {/* Registration Dialog */}
      <Dialog open={isRegisterModalOpen} onOpenChange={setIsRegisterModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Register New Proof Asset</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRegisterSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject-did">
                Subject DID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="subject-did"
                value={formData.subjectDid}
                onChange={(e) => setFormData({ ...formData, subjectDid: e.target.value })}
                placeholder="did:example:subject123"
                className="font-mono"
                required
                data-testid="input-subject-did"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="issuer-did">
                Issuer DID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="issuer-did"
                value={formData.issuerDid}
                onChange={(e) => setFormData({ ...formData, issuerDid: e.target.value })}
                placeholder="did:example:issuer456"
                className="font-mono"
                required
                data-testid="input-issuer-did"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="proof-format">
                Proof Format <span className="text-destructive">*</span>
              </Label>
              <Select
                value={formData.proofFormat}
                onValueChange={(value) => setFormData({ ...formData, proofFormat: value })}
              >
                <SelectTrigger id="proof-format" data-testid="select-proof-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="JWS">JWS</SelectItem>
                  <SelectItem value="ZK">ZK Proof</SelectItem>
                  <SelectItem value="Merkle">Merkle Proof</SelectItem>
                  <SelectItem value="HW">HW Attestation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="content-commitment">
                Content Commitment <span className="text-destructive">*</span>
              </Label>
              <Input
                id="content-commitment"
                value={formData.contentCommitment}
                onChange={(e) => setFormData({ ...formData, contentCommitment: e.target.value })}
                placeholder="QmTest123Hash"
                className="font-mono"
                required
                data-testid="textarea-content-commitment"
              />
              <p className="text-xs text-muted-foreground">
                Hash or CID of the content being proven
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="proof-data">
                Proof Data <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="proof-data"
                value={formData.proofData}
                onChange={(e) => setFormData({ ...formData, proofData: e.target.value })}
                placeholder='{"signature": "test_signature_data"}'
                className="font-mono min-h-[100px]"
                required
                data-testid="textarea-proof-data"
              />
              <p className="text-xs text-muted-foreground">
                JSON object containing proof data
              </p>
            </div>
            
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsRegisterModalOpen(false)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={registerMutation.isPending}
                data-testid="button-submit"
              >
                {registerMutation.isPending ? "Registering..." : "Register Proof"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
