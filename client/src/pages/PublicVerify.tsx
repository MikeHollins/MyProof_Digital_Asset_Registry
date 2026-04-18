// Public proof-asset verification page — `/verify/:proofAssetId`.
//
// What regulators and curious merchants see when they want to independently
// confirm a single proof asset. No auth required.
//
// Shows:
//   - Proof asset core fields (commitment, issuer DID, policy CID, format)
//   - Trust-tier badge (marketing + canonical via tooltip)
//   - Policy resolution (name + plain-language description)
//   - Session bindings (hash-only, no PII)
//   - Links to the epoch root that includes this proof's audit event
//
// Client-side can independently run the RISC Zero WASM verifier (bundle
// deferred until a real verification key + journal are wired end-to-end).

import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { useState } from "react";
import { ShieldCheck, Globe, Hash, FileText, BadgeCheck, ExternalLink, Key, Clock, Archive, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TrustTierBadge } from "@/components/TrustTierBadge";
import type { TrustLevel } from "@/lib/trust-ladder";

interface ProofAsset {
  proofAssetId: string;
  proofAssetCommitment: string;
  issuerDid: string;
  partnerId: string | null;
  subjectBinding: string | null;
  proofFormat: string;
  proofDigest: string;
  digestAlg: string;
  proofUri: string | null;
  constraintHash: string;
  constraintCid: string | null;
  policyHash: string;
  policyCid: string;
  circuitOrSchemaId: string | null;
  circuitCid: string | null;
  schemaCid: string | null;
  contentCids: string[] | null;
  license: Record<string, unknown> | null;
  statusListUrl: string;
  statusListIndex: string;
  statusPurpose: string;
  attestations: Record<string, unknown> | null;
  auditCid: string | null;
  verificationStatus: string | null;
  verificationAlgorithm: string | null;
  verificationPublicKeyDigest: string | null;
  verificationTimestamp: string | null;
  verificationMetadata: Record<string, unknown> | null;
  verifierProofRef: string | null;
  ttlSeconds: number | null;
  expiresAt: string | null;
  createdAt: string;
}

interface Policy {
  policy_id: string;
  policy_cid: string;
  name: string;
  version: string;
  plain_language: string;
  min_trust_level: TrustLevel;
  ttl_seconds: number;
  jurisdiction: string;
  active: boolean;
}

function FpShort({ value, len = 16 }: { value: string | null | undefined; len?: number }) {
  if (!value) return <span className="text-muted-foreground italic">—</span>;
  return <code className="text-xs font-mono">{value.substring(0, len)}…</code>;
}

// Decode a JWS/JWT payload without verifying the signature (public inspection only).
// The actual crypto verification happens via regulator-side WASM verifier in Phase 7.5.
function decodeJwsPayload(jws: string): Record<string, unknown> | null {
  try {
    const parts = jws.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function JwsInspector({ jws }: { jws: string }) {
  const [expanded, setExpanded] = useState(false);
  const payload = decodeJwsPayload(jws);
  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setExpanded((x) => !x)}>
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {expanded ? "Collapse" : "Decode payload (no signature verification)"}
      </Button>
      {expanded && (
        <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">
          {payload ? JSON.stringify(payload, null, 2) : <em>Could not decode JWS payload.</em>}
        </pre>
      )}
      <div className="text-xs text-muted-foreground">
        Raw JWS (<span className="font-mono">{jws.length}</span> chars, 3 segments): <FpShort value={jws} len={48} />
      </div>
    </div>
  );
}

export default function PublicVerify() {
  const [, params] = useRoute<{ proofAssetId: string }>("/verify/:proofAssetId");
  const proofAssetId = params?.proofAssetId;

  const asset = useQuery<ProofAsset>({
    queryKey: [`/api/proof-assets/${proofAssetId}`],
    enabled: !!proofAssetId,
  });

  const policyCid = asset.data?.policyCid;
  const policy = useQuery<{ ok: boolean; policy: Policy }>({
    queryKey: [`/api/policies/${policyCid}`],
    enabled: !!policyCid,
  });

  if (!proofAssetId) return <div className="p-6 text-destructive">Missing proof asset ID in URL.</div>;

  const verificationMeta = (asset.data?.verificationMetadata ?? {}) as Record<string, unknown>;
  const declaredTrust = typeof verificationMeta.trust_level === "string"
    ? (verificationMeta.trust_level as TrustLevel)
    : null;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Verify Proof</h1>
            <p className="text-sm text-muted-foreground">
              Independent view of a MyProof verification record. No personal data is shown because none is stored.
            </p>
          </div>
        </div>
      </motion.div>

      {asset.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : asset.isError || !asset.data ? (
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            Proof asset not found: <code>{proofAssetId}</code>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <BadgeCheck className="h-5 w-5 text-green-600" />
                Proof summary
              </CardTitle>
              {declaredTrust && <TrustTierBadge trustLevel={declaredTrust} size="md" />}
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Asset ID</dt>
                  <dd className="font-mono text-xs break-all">{asset.data.proofAssetId}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Verification status</dt>
                  <dd>
                    <Badge variant={asset.data.verificationStatus === "verified" ? "default" : "outline"}>
                      {asset.data.verificationStatus ?? "pending"}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Proof format</dt>
                  <dd className="font-mono">{asset.data.proofFormat}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Digest algorithm</dt>
                  <dd className="font-mono">{asset.data.digestAlg}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Issuer DID</dt>
                  <dd className="truncate font-mono text-xs">{asset.data.issuerDid}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Verifier partner</dt>
                  <dd className="font-mono text-xs">{asset.data.partnerId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Subject binding</dt>
                  <dd className="font-mono text-xs">{asset.data.subjectBinding ?? <span className="italic text-muted-foreground">n/a</span>}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Circuit / schema</dt>
                  <dd className="font-mono">{asset.data.circuitOrSchemaId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="font-mono text-xs">{new Date(asset.data.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Verified at</dt>
                  <dd className="font-mono text-xs">
                    {asset.data.verificationTimestamp ? new Date(asset.data.verificationTimestamp).toLocaleString() : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">TTL</dt>
                  <dd className="font-mono">
                    {asset.data.ttlSeconds ? `${(asset.data.ttlSeconds / 86400).toFixed(0)}d` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Expires</dt>
                  <dd className="font-mono text-xs">
                    {asset.data.expiresAt ? new Date(asset.data.expiresAt).toLocaleString() : "—"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hash className="h-5 w-5 text-primary" />
                Cryptographic commitments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">Commitment</dt>
                  <dd><FpShort value={asset.data.proofAssetCommitment} len={48} /></dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">Proof digest</dt>
                  <dd><FpShort value={asset.data.proofDigest} len={48} /></dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">Constraint hash</dt>
                  <dd><FpShort value={asset.data.constraintHash} len={48} /></dd>
                </div>
                {asset.data.constraintCid && (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">Constraint CID</dt>
                    <dd><FpShort value={asset.data.constraintCid} len={48} /></dd>
                  </div>
                )}
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">Policy hash</dt>
                  <dd><FpShort value={asset.data.policyHash} len={48} /></dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">Policy CID</dt>
                  <dd><FpShort value={asset.data.policyCid} len={48} /></dd>
                </div>
                {asset.data.circuitCid && (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">Circuit CID</dt>
                    <dd><FpShort value={asset.data.circuitCid} len={48} /></dd>
                  </div>
                )}
                {asset.data.schemaCid && (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">Schema CID</dt>
                    <dd><FpShort value={asset.data.schemaCid} len={48} /></dd>
                  </div>
                )}
                {asset.data.auditCid && (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">Audit CID</dt>
                    <dd><FpShort value={asset.data.auditCid} len={48} /></dd>
                  </div>
                )}
                {asset.data.contentCids && asset.data.contentCids.length > 0 && (
                  <div>
                    <dt className="text-muted-foreground mb-1">Content CIDs</dt>
                    <dd className="space-y-1">
                      {asset.data.contentCids.map((c, i) => (
                        <div key={i}><FpShort value={c} len={48} /></div>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {(asset.data.verifierProofRef || asset.data.verificationAlgorithm || asset.data.verificationPublicKeyDigest) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-primary" />
                  Verifier proof reference
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {asset.data.verificationAlgorithm && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Algorithm: </span>
                    <code className="font-mono">{asset.data.verificationAlgorithm}</code>
                  </div>
                )}
                {asset.data.verificationPublicKeyDigest && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Verifier pubkey digest: </span>
                    <FpShort value={asset.data.verificationPublicKeyDigest} len={40} />
                  </div>
                )}
                {asset.data.verifierProofRef && (
                  <div className="text-sm">
                    <div className="mb-2 text-muted-foreground">JWS receipt (decoded for inspection; cryptographic verification is out-of-band):</div>
                    <JwsInspector jws={asset.data.verifierProofRef} />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(asset.data.attestations || asset.data.verificationMetadata) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Archive className="h-5 w-5 text-primary" />
                  Attestations + verification metadata
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {asset.data.attestations && (
                  <div>
                    <div className="mb-1 text-sm text-muted-foreground">Attestations (NFC / device / liveness signals — hashes only, no PII)</div>
                    <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">
                      {JSON.stringify(asset.data.attestations, null, 2)}
                    </pre>
                  </div>
                )}
                {asset.data.verificationMetadata && (
                  <div>
                    <div className="mb-1 text-sm text-muted-foreground">Verification metadata (trust tier + bindings summary)</div>
                    <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">
                      {JSON.stringify(asset.data.verificationMetadata, null, 2)}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {asset.data.license && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  License
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">
                  {JSON.stringify(asset.data.license, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Policy applied
              </CardTitle>
            </CardHeader>
            <CardContent>
              {policy.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : policy.data?.policy ? (
                <div className="space-y-2 text-sm">
                  <div className="font-semibold">
                    {policy.data.policy.name} <span className="text-xs text-muted-foreground">v{policy.data.policy.version}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Jurisdiction: <span className="font-mono">{policy.data.policy.jurisdiction}</span> · TTL:{" "}
                    <span className="font-mono">{(policy.data.policy.ttl_seconds / 86400).toFixed(0)}d</span> · Min tier:{" "}
                    <code>{policy.data.policy.min_trust_level}</code>
                  </div>
                  <div className="mt-2">{policy.data.policy.plain_language}</div>
                  <div className="mt-2 text-xs font-mono text-muted-foreground">
                    CID: <FpShort value={policy.data.policy.policy_cid} len={32} />
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Policy <code>{policyCid}</code> not resolved.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                Status list binding
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="text-sm space-y-2">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground shrink-0 w-28">Purpose</dt>
                  <dd><code>{asset.data.statusPurpose}</code></dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground shrink-0 w-28">URL</dt>
                  <dd className="truncate">
                    <a
                      href={asset.data.statusListUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1"
                    >
                      {asset.data.statusListUrl} <ExternalLink className="h-3 w-3" />
                    </a>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground shrink-0 w-28">Bit index</dt>
                  <dd className="font-mono">
                    {asset.data.statusListIndex} <span className="text-muted-foreground text-xs">(position in the W3C bitstring)</span>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <div className="pt-2 text-center text-xs text-muted-foreground">
            All fields on this page are commitments, hashes, booleans, enums, or public metadata.
            No personal data is stored or shown — see the PII invariant at{" "}
            <Link href="/transparency" className="text-primary hover:underline">/transparency</Link>.
          </div>
        </>
      )}
    </div>
  );
}
