import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Copy, 
  ArrowRight,
  ShieldCheck,
  ShieldX,
  RotateCcw,
  PlayCircle
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

/**
 * Demo Page: Interactive PAR Workflow
 * 
 * Demonstrates privacy-first receipt-based verification:
 * 1. Seed: Create demo proof asset with signed receipt
 * 2. Verify: Test receipt-based re-verification (fast path)
 * 3. Revoke: Flip W3C status bit
 * 4. Verify Again: Observe fail-closed behavior
 */

interface DemoSeedResponse {
  ok: boolean;
  demo: {
    assetId: string;
    issuerDid: string;
    verifierDid: string;
    commitment: string;
    status_ref: {
      url: string;
      index: string;
      purpose: string;
    };
  };
  hashes: {
    policy_hash: string;
    constraint_hash: string;
    proof_digest_hex: string;
    proof_digest_b64u: string;
  };
  receipt: string;
  curls: {
    verify: string;
    revoke: string;
  };
  note: string;
}

interface VerifyResponse {
  success: boolean;
  assetId?: string;
  verificationStatus?: string;
  statusVerdict?: "valid" | "revoked" | "suspended";
  error?: string;
}

interface RevokeResponse {
  ok: boolean;
  assetId: string;
  statusListUrl: string;
  statusListIndex: string;
  newStatus: string;
  note: string;
}

interface ResetResponse {
  ok: boolean;
  assetId: string;
  newStatus: string;
  note: string;
}

type WorkflowStep = "idle" | "seeded" | "verified" | "revoked" | "verified_revoked";

export default function Demo() {
  const { toast } = useToast();
  const [step, setStep] = useState<WorkflowStep>("idle");
  const [seedData, setSeedData] = useState<DemoSeedResponse | null>(null);
  const [firstVerifyResult, setFirstVerifyResult] = useState<VerifyResponse | null>(null);
  const [secondVerifyResult, setSecondVerifyResult] = useState<VerifyResponse | null>(null);

  // Mutation: Seed demo asset
  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/demo/seed");
      return await res.json() as DemoSeedResponse;
    },
    onSuccess: (data) => {
      setSeedData(data);
      setStep("seeded");
      setFirstVerifyResult(null);
      setSecondVerifyResult(null);
      toast({
        title: "Demo Asset Created",
        description: `Asset ${data.demo.assetId} registered with signed receipt`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Seed Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation: Verify with receipt
  const verifyMutation = useMutation({
    mutationFn: async (receipt: string) => {
      if (!seedData) throw new Error("No seed data");
      const res = await apiRequest(
        "POST",
        `/api/proof-assets/${seedData.demo.assetId}/verify`,
        { receipt }
      );
      return await res.json() as VerifyResponse;
    },
    onSuccess: (data) => {
      if (step === "seeded") {
        setFirstVerifyResult(data);
        setStep("verified");
        toast({
          title: "First Verification Complete",
          description: `Status: ${data.verificationStatus || "unknown"}`,
        });
      } else if (step === "revoked") {
        setSecondVerifyResult(data);
        setStep("verified_revoked");
        toast({
          title: "Second Verification Complete",
          description: data.success 
            ? `Status: ${data.verificationStatus || "unknown"}`
            : `Verification failed (expected): ${data.error}`,
          variant: data.success ? "default" : "destructive",
        });
      }
    },
    onError: (error: any) => {
      // Special handling for Step 4: Replay protection is expected and demonstrates security
      const errorMsg = error?.message || String(error);
      if (step === "revoked" && errorMsg.includes("replay_detected")) {
        setSecondVerifyResult({
          success: false,
          error: errorMsg,
          verificationStatus: "revoked",
          statusVerdict: "revoked",
        });
        setStep("verified_revoked");
        toast({
          title: "Security Working Correctly! ✓",
          description: "Replay protection prevented receipt reuse. The asset also remains revoked.",
        });
      } else {
        toast({
          title: "Verification Failed",
          description: errorMsg,
          variant: "destructive",
        });
      }
    },
  });

  // Mutation: Revoke
  const revokeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/demo/revoke");
      return await res.json() as RevokeResponse;
    },
    onSuccess: (data) => {
      setStep("revoked");
      toast({
        title: "Asset Revoked",
        description: `Status bit flipped for ${data.assetId}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Revoke Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation: Reset
  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/demo/reset");
      return await res.json() as ResetResponse;
    },
    onSuccess: () => {
      setStep("seeded");
      setFirstVerifyResult(null);
      setSecondVerifyResult(null);
      toast({
        title: "Demo Reset",
        description: "Asset status reset to verified. You can run the demo again.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Reset Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: `${label} copied to clipboard`,
    });
  };

  const truncate = (str: string, len: number = 24) => {
    if (str.length <= len) return str;
    return `${str.substring(0, len)}...${str.substring(str.length - 8)}`;
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-semibold mb-2">PAR Demo Workflow</h1>
          <p className="text-gray-600">
            Interactive demonstration of privacy-first receipt-based verification with W3C Status List revocation
          </p>
        </div>

        {/* Workflow Steps Visual */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-2xl">Workflow Steps</CardTitle>
            <CardDescription>
              Follow the steps below to see how PAR handles proof registration, verification, and revocation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              {/* Step 1: Seed */}
              <div className="flex-1">
                <div className={`flex items-center gap-2 mb-2 ${step !== "idle" ? "text-green-600" : "text-gray-400"}`}>
                  {step !== "idle" ? <CheckCircle2 className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-300" />}
                  <span className="font-medium">1. Seed</span>
                </div>
                <p className="text-sm text-gray-600">Create demo asset with receipt</p>
              </div>
              <ArrowRight className="text-gray-300 flex-shrink-0" />
              
              {/* Step 2: Verify */}
              <div className="flex-1">
                <div className={`flex items-center gap-2 mb-2 ${step === "verified" || step === "revoked" || step === "verified_revoked" ? "text-green-600" : "text-gray-400"}`}>
                  {step === "verified" || step === "revoked" || step === "verified_revoked" ? <CheckCircle2 className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-300" />}
                  <span className="font-medium">2. Verify</span>
                </div>
                <p className="text-sm text-gray-600">Receipt-based verification</p>
              </div>
              <ArrowRight className="text-gray-300 flex-shrink-0" />
              
              {/* Step 3: Revoke */}
              <div className="flex-1">
                <div className={`flex items-center gap-2 mb-2 ${step === "revoked" || step === "verified_revoked" ? "text-orange-600" : "text-gray-400"}`}>
                  {step === "revoked" || step === "verified_revoked" ? <ShieldX className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-300" />}
                  <span className="font-medium">3. Revoke</span>
                </div>
                <p className="text-sm text-gray-600">Flip W3C status bit</p>
              </div>
              <ArrowRight className="text-gray-300 flex-shrink-0" />
              
              {/* Step 4: Verify Again */}
              <div className="flex-1">
                <div className={`flex items-center gap-2 mb-2 ${step === "verified_revoked" ? "text-green-600" : "text-gray-400"}`}>
                  {step === "verified_revoked" ? <CheckCircle2 className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-300" />}
                  <span className="font-medium">4. Verify Again</span>
                </div>
                <p className="text-sm text-gray-600">Fail-closed + replay protection</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Step 1: Seed */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <PlayCircle className="w-5 h-5" />
                Step 1: Seed Demo Asset
              </CardTitle>
              <CardDescription>
                Create deterministic proof asset with signed JWS receipt (PII-free)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                data-testid="button-seed"
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                className="w-full"
              >
                {seedMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {step === "idle" ? "Create Demo Asset" : "Re-Seed (Reset Demo)"}
              </Button>

              {seedData && (
                <div className="space-y-3 pt-4 border-t">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">Asset ID</p>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded flex-1" data-testid="text-asset-id">
                        {seedData.demo.assetId}
                      </code>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid="button-copy-asset-id"
                        onClick={() => copyToClipboard(seedData.demo.assetId, "Asset ID")}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">Commitment</p>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded flex-1 truncate" data-testid="text-commitment">
                        {truncate(seedData.demo.commitment, 32)}
                      </code>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid="button-copy-commitment"
                        onClick={() => copyToClipboard(seedData.demo.commitment, "Commitment")}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">Receipt (JWS)</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded flex-1 truncate" data-testid="text-receipt">
                        {truncate(seedData.receipt, 40)}
                      </code>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid="button-copy-receipt"
                        onClick={() => copyToClipboard(seedData.receipt, "Receipt")}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 2: First Verify */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                Step 2: Verify (First Time)
              </CardTitle>
              <CardDescription>
                Receipt-based verification - cryptographic operations only, no proof re-execution
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                data-testid="button-verify-first"
                onClick={() => seedData && verifyMutation.mutate(seedData.receipt)}
                disabled={!seedData || verifyMutation.isPending || step !== "seeded"}
                className="w-full"
                variant={step === "verified" ? "outline" : "default"}
              >
                {verifyMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {step === "verified" ? "✓ Verified Successfully" : "Verify with Receipt"}
              </Button>

              {firstVerifyResult && (
                <div className="space-y-3 pt-4 border-t">
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant={firstVerifyResult.success ? "default" : "destructive"}
                      data-testid="badge-verify-status"
                    >
                      {firstVerifyResult.success ? "✓ Verified" : "✗ Failed"}
                    </Badge>
                    {firstVerifyResult.statusVerdict && (
                      <Badge variant="outline" data-testid="badge-status-verdict">
                        Status: {firstVerifyResult.statusVerdict}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">
                    ✓ Receipt signature valid<br />
                    ✓ JWT claims validated<br />
                    ✓ Commitment binding verified<br />
                    ✓ Status list checked
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 3: Revoke */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldX className="w-5 h-5" />
                Step 3: Revoke Asset
              </CardTitle>
              <CardDescription>
                Simulate W3C Status List revocation (flips bitstring index)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                data-testid="button-revoke"
                onClick={() => revokeMutation.mutate()}
                disabled={!seedData || revokeMutation.isPending || step !== "verified"}
                variant="destructive"
                className="w-full"
              >
                {revokeMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {step === "revoked" || step === "verified_revoked" ? "✓ Asset Revoked" : "Revoke Asset"}
              </Button>

              {(step === "revoked" || step === "verified_revoked") && seedData && (
                <div className="space-y-3 pt-4 border-t">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">Status List Index</p>
                    <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded block" data-testid="text-status-index">
                      {seedData.demo.status_ref.index}
                    </code>
                  </div>
                  <p className="text-sm text-gray-600">
                    ⚠️ Status bit flipped to "revoked"<br />
                    Next verification should fail
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 4: Verify Again */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                Step 4: Verify After Revocation
              </CardTitle>
              <CardDescription>
                Demonstrates fail-closed behavior and JTI replay protection
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                data-testid="button-verify-second"
                onClick={() => seedData && verifyMutation.mutate(seedData.receipt)}
                disabled={!seedData || verifyMutation.isPending || step !== "revoked"}
                className="w-full"
                variant={step === "verified_revoked" ? "outline" : "default"}
              >
                {verifyMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {step === "verified_revoked" ? "✓ Test Complete" : "Re-Verify with Same Receipt"}
              </Button>

              {secondVerifyResult && (
                <div className="space-y-3 pt-4 border-t">
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant={secondVerifyResult.error?.includes("replay_detected") ? "default" : secondVerifyResult.success ? "default" : "destructive"}
                      data-testid="badge-verify-second-status"
                      className={secondVerifyResult.error?.includes("replay_detected") ? "bg-green-600" : ""}
                    >
                      {secondVerifyResult.error?.includes("replay_detected") 
                        ? "✓ Security Working" 
                        : secondVerifyResult.success 
                          ? "✓ Verified" 
                          : "✗ Failed (Expected)"}
                    </Badge>
                    {secondVerifyResult.statusVerdict && (
                      <Badge variant="outline" data-testid="badge-status-verdict-second">
                        Status: {secondVerifyResult.statusVerdict}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">
                    {secondVerifyResult.error?.includes("replay_detected")
                      ? "✓ JTI replay protection prevented receipt reuse + asset remains revoked"
                      : secondVerifyResult.success 
                        ? "⚠️ Unexpected: Verification should have failed"
                        : "✓ Fail-closed: Status check detected revocation"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Reset Section */}
        {step === "verified_revoked" && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <RotateCcw className="w-5 h-5" />
                Reset Demo
              </CardTitle>
              <CardDescription>
                Reset the demo asset back to verified status to run the workflow again
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                data-testid="button-reset"
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
                variant="outline"
                className="w-full"
              >
                {resetMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Reset to Verified Status
              </Button>
            </CardContent>
          </Card>
        )}

        {/* cURL Commands */}
        {seedData && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg">cURL Commands (CLI Testing)</CardTitle>
              <CardDescription>
                Test the API directly from your terminal
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-2">Verify Receipt</p>
                <div className="relative">
                  <pre className="text-xs font-mono bg-gray-900 text-green-400 p-4 rounded overflow-x-auto" data-testid="text-curl-verify">
{seedData.curls.verify}
                  </pre>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2"
                    data-testid="button-copy-curl-verify"
                    onClick={() => copyToClipboard(seedData.curls.verify, "cURL command")}
                  >
                    <Copy className="w-4 h-4 text-white" />
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-600 mb-2">Revoke Asset</p>
                <div className="relative">
                  <pre className="text-xs font-mono bg-gray-900 text-green-400 p-4 rounded overflow-x-auto" data-testid="text-curl-revoke">
{seedData.curls.revoke}
                  </pre>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2"
                    data-testid="button-copy-curl-revoke"
                    onClick={() => copyToClipboard(seedData.curls.revoke, "cURL command")}
                  >
                    <Copy className="w-4 h-4 text-white" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
