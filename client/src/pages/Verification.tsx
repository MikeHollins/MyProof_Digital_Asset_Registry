import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { CidDisplay } from "@/components/CidDisplay";
import { ProofFormatBadge } from "@/components/ProofFormatBadge";
import type { InsertProofAsset, VerificationResult } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Step = "input" | "verifying" | "results";

export default function Verification() {
  const [step, setStep] = useState<Step>("input");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    issuer_did: "",
    subject_binding: "",
    proof_format: "JWS",
    proof_uri: "",
    proof_digest: "",
    digest_alg: "sha2-256",
    constraint_hash: "",
    constraint_cid: "",
    policy_hash: "",
    policy_cid: "",
    circuit_or_schema_id: "",
    circuit_cid: "",
    schema_cid: "",
  });

  const registerMutation = useMutation({
    mutationFn: async (data: InsertProofAsset) => {
      return await apiRequest("POST", "/api/proof-assets", data);
    },
    onSuccess: (data) => {
      setResult({
        ok: true,
        timestamp: new Date().toISOString(),
        proofAssetId: data.proofAssetId,
      });
      setStep("results");
      queryClient.invalidateQueries({ queryKey: ['/api/proof-assets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({
        title: "Proof registered successfully",
        description: "Your cryptographic proof has been verified and registered.",
      });
    },
    onError: (error: any) => {
      setResult({
        ok: false,
        reason: error.message || "Verification failed",
        timestamp: new Date().toISOString(),
      });
      setStep("results");
      toast({
        variant: "destructive",
        title: "Verification failed",
        description: error.message || "Failed to register proof",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep("verifying");

    const payload: InsertProofAsset = {
      issuerDid: formData.issuer_did,
      subjectBinding: formData.subject_binding || undefined,
      verifier_proof_ref: {
        proof_format: formData.proof_format as any,
        proof_uri: formData.proof_uri || undefined,
        proof_digest: formData.proof_digest,
        digest_alg: formData.digest_alg as any,
      },
      constraintHash: formData.constraint_hash,
      constraintCid: formData.constraint_cid || undefined,
      policyHash: formData.policy_hash,
      policyCid: formData.policy_cid,
      circuitOrSchemaId: formData.circuit_or_schema_id || undefined,
      circuitCid: formData.circuit_cid || undefined,
      schemaCid: formData.schema_cid || undefined,
      proofFormat: formData.proof_format,
      proofDigest: formData.proof_digest,
      digestAlg: formData.digest_alg,
      statusListUrl: "",
      statusListIndex: "",
      statusPurpose: "revocation",
    };

    registerMutation.mutate(payload);
  };

  const resetForm = () => {
    setStep("input");
    setResult(null);
    setFormData({
      issuer_did: "",
      subject_binding: "",
      proof_format: "JWS",
      proof_uri: "",
      proof_digest: "",
      digest_alg: "sha2-256",
      constraint_hash: "",
      constraint_cid: "",
      policy_hash: "",
      policy_cid: "",
      circuit_or_schema_id: "",
      circuit_cid: "",
      schema_cid: "",
    });
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-4xl font-semibold text-foreground">Proof Verification</h1>
        <p className="text-muted-foreground mt-2">
          Register and verify cryptographic proofs with privacy-first design
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-center gap-4 py-6">
        <div className={`flex items-center gap-2 ${step === "input" ? "text-primary" : "text-muted-foreground"}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
            step === "input" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
          }`}>
            1
          </div>
          <span className="text-sm font-medium">Input</span>
        </div>
        <div className="w-16 h-px bg-border" />
        <div className={`flex items-center gap-2 ${step === "verifying" ? "text-primary" : "text-muted-foreground"}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
            step === "verifying" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
          }`}>
            {step === "verifying" ? <Loader2 className="h-4 w-4 animate-spin" /> : "2"}
          </div>
          <span className="text-sm font-medium">Verifying</span>
        </div>
        <div className="w-16 h-px bg-border" />
        <div className={`flex items-center gap-2 ${step === "results" ? "text-primary" : "text-muted-foreground"}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
            step === "results" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
          }`}>
            3
          </div>
          <span className="text-sm font-medium">Results</span>
        </div>
      </div>

      {/* Input Form */}
      {step === "input" && (
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <h2 className="text-lg font-medium">Proof Registration Form</h2>
              <p className="text-sm text-muted-foreground">
                All fields marked with <span className="text-destructive">*</span> are required
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* DID Section */}
              <div className="space-y-4">
                <h3 className="text-base font-medium border-b border-border pb-2">
                  Identity Information
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="issuer_did">
                    Issuer DID <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="issuer_did"
                    value={formData.issuer_did}
                    onChange={(e) => setFormData({ ...formData, issuer_did: e.target.value })}
                    placeholder="did:example:issuer123"
                    className="font-mono"
                    required
                    data-testid="input-issuer-did"
                  />
                  <p className="text-xs text-muted-foreground">
                    Decentralized Identifier of the proof issuer
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subject_binding">Subject Binding</Label>
                  <Input
                    id="subject_binding"
                    value={formData.subject_binding}
                    onChange={(e) => setFormData({ ...formData, subject_binding: e.target.value })}
                    placeholder="Optional subject binding"
                    className="font-mono"
                    data-testid="input-subject-binding"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional binding to a subject identifier
                  </p>
                </div>
              </div>

              {/* Proof Details */}
              <div className="space-y-4">
                <h3 className="text-base font-medium border-b border-border pb-2">
                  Proof Details
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="proof_format">
                      Proof Format <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={formData.proof_format}
                      onValueChange={(value) => setFormData({ ...formData, proof_format: value })}
                    >
                      <SelectTrigger id="proof_format" data-testid="select-proof-format">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
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
                    <Label htmlFor="digest_alg">
                      Digest Algorithm <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={formData.digest_alg}
                      onValueChange={(value) => setFormData({ ...formData, digest_alg: value })}
                    >
                      <SelectTrigger id="digest_alg" data-testid="select-digest-alg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sha2-256">SHA-256</SelectItem>
                        <SelectItem value="sha3-256">SHA3-256</SelectItem>
                        <SelectItem value="blake3">BLAKE3</SelectItem>
                        <SelectItem value="multihash">Multihash</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="proof_digest">
                    Proof Digest <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="proof_digest"
                    value={formData.proof_digest}
                    onChange={(e) => setFormData({ ...formData, proof_digest: e.target.value })}
                    placeholder="Base64url-encoded proof digest"
                    className="font-mono text-sm resize-none"
                    rows={3}
                    required
                    data-testid="input-proof-digest"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="proof_uri">Proof URI</Label>
                  <Input
                    id="proof_uri"
                    value={formData.proof_uri}
                    onChange={(e) => setFormData({ ...formData, proof_uri: e.target.value })}
                    placeholder="data:application/jws,..."
                    className="font-mono"
                    data-testid="input-proof-uri"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional URI pointing to the proof artifact
                  </p>
                </div>
              </div>

              {/* Policy & Constraints */}
              <div className="space-y-4">
                <h3 className="text-base font-medium border-b border-border pb-2">
                  Policy & Constraints
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="policy_hash">
                      Policy Hash <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="policy_hash"
                      value={formData.policy_hash}
                      onChange={(e) => setFormData({ ...formData, policy_hash: e.target.value })}
                      placeholder="Policy hash"
                      className="font-mono"
                      required
                      data-testid="input-policy-hash"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="policy_cid">
                      Policy CID <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="policy_cid"
                      value={formData.policy_cid}
                      onChange={(e) => setFormData({ ...formData, policy_cid: e.target.value })}
                      placeholder="Content ID of policy"
                      className="font-mono"
                      required
                      data-testid="input-policy-cid"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="constraint_hash">
                      Constraint Hash <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="constraint_hash"
                      value={formData.constraint_hash}
                      onChange={(e) => setFormData({ ...formData, constraint_hash: e.target.value })}
                      placeholder="Constraint hash"
                      className="font-mono"
                      required
                      data-testid="input-constraint-hash"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="constraint_cid">Constraint CID</Label>
                    <Input
                      id="constraint_cid"
                      value={formData.constraint_cid}
                      onChange={(e) => setFormData({ ...formData, constraint_cid: e.target.value })}
                      placeholder="Content ID of constraint"
                      className="font-mono"
                      data-testid="input-constraint-cid"
                    />
                  </div>
                </div>
              </div>

              {/* Optional Fields */}
              <div className="space-y-4">
                <h3 className="text-base font-medium border-b border-border pb-2">
                  Optional Metadata
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="circuit_or_schema_id">Circuit/Schema ID</Label>
                    <Input
                      id="circuit_or_schema_id"
                      value={formData.circuit_or_schema_id}
                      onChange={(e) => setFormData({ ...formData, circuit_or_schema_id: e.target.value })}
                      placeholder="Circuit or schema identifier"
                      className="font-mono"
                      data-testid="input-circuit-schema-id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="circuit_cid">Circuit CID</Label>
                    <Input
                      id="circuit_cid"
                      value={formData.circuit_cid}
                      onChange={(e) => setFormData({ ...formData, circuit_cid: e.target.value })}
                      placeholder="Content ID of circuit"
                      className="font-mono"
                      data-testid="input-circuit-cid"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schema_cid">Schema CID</Label>
                  <Input
                    id="schema_cid"
                    value={formData.schema_cid}
                    onChange={(e) => setFormData({ ...formData, schema_cid: e.target.value })}
                    placeholder="Content ID of schema"
                    className="font-mono"
                    data-testid="input-schema-cid"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Button type="button" variant="outline" onClick={resetForm} data-testid="button-reset">
                  Reset
                </Button>
                <Button type="submit" data-testid="button-submit-verification">
                  Register & Verify Proof
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}

      {/* Verifying State */}
      {step === "verifying" && (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 className="h-16 w-16 mx-auto text-primary animate-spin mb-4" />
            <h3 className="text-lg font-medium mb-2">Verifying Proof...</h3>
            <p className="text-muted-foreground">
              Cryptographic verification in progress. This may take a moment.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {step === "results" && result && (
        <Card>
          <CardContent className="p-8 space-y-6">
            {result.ok ? (
              <>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold text-green-600">
                      Verification Successful
                    </h3>
                    <p className="text-muted-foreground">
                      Proof has been cryptographically verified and registered
                    </p>
                  </div>
                </div>

                {result.proofAssetId && (
                  <div className="space-y-2 bg-muted/50 p-4 rounded">
                    <Label className="text-sm text-muted-foreground">Proof Asset ID</Label>
                    <CidDisplay value={result.proofAssetId} truncateLength={48} />
                  </div>
                )}

                <div className="flex gap-4">
                  <Button onClick={resetForm} variant="outline" data-testid="button-register-another">
                    Register Another Proof
                  </Button>
                  <Button onClick={() => window.location.href = "/proofs"} data-testid="button-view-all">
                    View All Proofs
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <AlertCircle className="h-8 w-8 text-red-600" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold text-red-600">
                      Verification Failed
                    </h3>
                    <p className="text-muted-foreground">
                      The proof could not be verified
                    </p>
                  </div>
                </div>

                {result.reason && (
                  <div className="space-y-2 bg-destructive/10 p-4 rounded">
                    <Label className="text-sm text-destructive">Error Details</Label>
                    <p className="text-sm font-mono">{result.reason}</p>
                  </div>
                )}

                <div className="flex gap-4">
                  <Button onClick={resetForm} data-testid="button-try-again">
                    Try Again
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
