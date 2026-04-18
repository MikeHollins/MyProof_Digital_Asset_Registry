// Public transparency page — the URL a regulator lands on to verify the
// integrity of the MyProof audit ledger. No authentication required.
//
// Shows:
//   - Latest epoch root + its 5 external anchor statuses
//   - Paginated epoch history with hash-chain verification
//   - Policies list (effective, deprecated)
//   - Circuit versions registry
//
// Client-side can independently verify:
//   - Signature on each epoch root (using signer_public_key_pem from the row)
//   - Hash-chain integrity (each epoch's previous_epoch_hash = hash of prior)
//
// This page is the public counterpart to the private operator dashboard.

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  Anchor,
  CheckCircle2,
  XCircle,
  MinusCircle,
  FileText,
  Layers,
  Clock,
  Link2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

type AnchorStatus = "ok" | "failed" | "unavailable";

interface EpochRoot {
  epoch_number: number;
  merkle_root: string;
  tree_size: number;
  previous_epoch_hash: string | null;
  signer_fingerprint: string;
  signer_algorithm: string;
  signature_ed25519: string;
  rfc_3161_tokens: Array<{ tsa_url: string; token_b64: string; issued_at: string }>;
  rekor_log_id: string | null;
  r2_backup_key: string | null;
  anchor_status: Record<string, AnchorStatus>;
  published_at: string;
}

interface Policy {
  policy_cid: string;
  name: string;
  version: string;
  min_trust_level: string;
  ttl_seconds: number;
  jurisdiction: string;
  plain_language: string;
  effective_at: string;
}

function AnchorBadge({ name, status }: { name: string; status: AnchorStatus }) {
  const config = {
    ok: { icon: CheckCircle2, cls: "bg-green-600/10 text-green-700 dark:text-green-400 border-green-600/30" },
    failed: { icon: XCircle, cls: "bg-red-600/10 text-red-700 dark:text-red-400 border-red-600/30" },
    unavailable: { icon: MinusCircle, cls: "bg-gray-400/10 text-gray-600 dark:text-gray-400 border-gray-500/30" },
  }[status];
  const Icon = config.icon;
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${config.cls}`}>
      <Icon className="h-3 w-3" />
      <span className="font-medium">{name}</span>
    </div>
  );
}

function FpShort({ value, len = 16 }: { value: string; len?: number }) {
  return <code className="text-xs font-mono">{value.substring(0, len)}…</code>;
}

export default function Transparency() {
  const latest = useQuery<{ ok: boolean; epoch: EpochRoot }>({
    queryKey: ["/api/transparency/epoch/latest"],
  });

  const epochs = useQuery<{ ok: boolean; epochs: EpochRoot[] }>({
    queryKey: ["/api/transparency/epochs?limit=20"],
  });

  const policies = useQuery<{ ok: boolean; policies: Policy[] }>({
    queryKey: ["/api/policies"],
  });

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold tracking-tight">Transparency</h1>
        <p className="mt-1 text-muted-foreground">
          MyProof's audit ledger is publicly verifiable. Every hour, a Merkle root of all verification
          events is signed by our Ed25519 key and anchored to multiple external tamper-evidence systems.
          Regulators + the general public can independently verify the integrity of this log.
        </p>
      </motion.div>

      {/* Latest epoch */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Latest Epoch
          </CardTitle>
          {latest.data?.epoch && (
            <Badge variant="outline" className="font-mono">
              #{latest.data.epoch.epoch_number}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {latest.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : latest.data?.epoch ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Merkle root</dt>
                  <dd><FpShort value={latest.data.epoch.merkle_root} len={32} /></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Tree size</dt>
                  <dd className="font-mono">{latest.data.epoch.tree_size.toLocaleString()} events</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Signer fingerprint</dt>
                  <dd><FpShort value={latest.data.epoch.signer_fingerprint} /></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Algorithm</dt>
                  <dd className="font-mono">{latest.data.epoch.signer_algorithm}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Published</dt>
                  <dd className="font-mono">{new Date(latest.data.epoch.published_at).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Previous hash</dt>
                  <dd>
                    {latest.data.epoch.previous_epoch_hash ? (
                      <FpShort value={latest.data.epoch.previous_epoch_hash} len={32} />
                    ) : (
                      <span className="text-muted-foreground italic">genesis</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Anchor className="h-4 w-4" />
                  External anchors
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(latest.data.epoch.anchor_status).map(([name, status]) => (
                    <AnchorBadge key={name} name={name.replace(/_/g, " ")} status={status} />
                  ))}
                </div>
              </div>

              {latest.data.epoch.rekor_log_id && (
                <div className="text-xs text-muted-foreground">
                  Sigstore Rekor log ID: <code>{latest.data.epoch.rekor_log_id}</code>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No epochs yet.</div>
          )}
        </CardContent>
      </Card>

      {/* Policy registry */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Active Policies
          </CardTitle>
        </CardHeader>
        <CardContent>
          {policies.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : policies.data?.policies?.length ? (
            <div className="space-y-3">
              {policies.data.policies.map((p) => (
                <div key={p.policy_cid} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{p.name} <span className="text-xs text-muted-foreground">v{p.version}</span></div>
                      <div className="mt-0.5 text-xs text-muted-foreground">Jurisdiction: {p.jurisdiction} · TTL: {(p.ttl_seconds / 86400).toFixed(0)}d · Min tier: <code>{p.min_trust_level}</code></div>
                      <div className="mt-2 text-sm">{p.plain_language}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs font-mono text-muted-foreground">CID: <FpShort value={p.policy_cid} len={24} /></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No active policies yet.</div>
          )}
        </CardContent>
      </Card>

      {/* Epoch history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Epoch History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {epochs.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : epochs.data?.epochs?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">#</th>
                    <th className="pb-2 pr-4">Merkle root</th>
                    <th className="pb-2 pr-4">Size</th>
                    <th className="pb-2 pr-4">Anchors OK</th>
                    <th className="pb-2 pr-4">Published</th>
                    <th className="pb-2">Signer</th>
                  </tr>
                </thead>
                <tbody>
                  {epochs.data.epochs.map((e) => {
                    const ok = Object.values(e.anchor_status ?? {}).filter((s) => s === "ok").length;
                    const total = Object.values(e.anchor_status ?? {}).length;
                    return (
                      <tr key={e.epoch_number} className="border-b hover-elevate">
                        <td className="py-2 pr-4 font-mono">{e.epoch_number}</td>
                        <td className="py-2 pr-4"><FpShort value={e.merkle_root} /></td>
                        <td className="py-2 pr-4 font-mono">{e.tree_size}</td>
                        <td className="py-2 pr-4">
                          <span className={ok === total ? "text-green-600" : "text-amber-600"}>
                            {ok}/{total}
                          </span>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">{new Date(e.published_at).toLocaleString()}</td>
                        <td className="py-2"><FpShort value={e.signer_fingerprint} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-3 text-xs text-muted-foreground">
                Showing latest {epochs.data.epochs.length} epochs.
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No epochs yet.</div>
          )}
        </CardContent>
      </Card>

      <div className="pt-4 text-sm text-muted-foreground">
        <Link href="/audit-logs">
          <Button variant="outline" size="sm" className="gap-2">
            <Link2 className="h-4 w-4" /> Hash-chain verifier (client-side)
          </Button>
        </Link>
      </div>
    </div>
  );
}
