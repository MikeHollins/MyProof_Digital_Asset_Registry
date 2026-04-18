// Hourly epoch-publisher orchestrator.
//
// Flow per epoch:
//   1. Fetch all audit events since the previous epoch (or since genesis)
//   2. Compute RFC 6962 Merkle root over their event_hash bytes
//   3. Canonicalize (epoch_number, merkle_root, tree_size, previous_epoch_hash, published_at)
//   4. Sign canonical bytes with Ed25519 (FileSigner or KmsSigner)
//   5. Fan out to external anchors in parallel:
//        - Sigstore RFC 3161 TSA
//        - FreeTSA RFC 3161 TSA
//        - Rekor v2 hashedrekord
//        - Cloudflare R2 WORM backup (if configured)
//   6. Insert epoch_roots row with the results + per-anchor status
//
// Cron schedule: hourly at :05 (cron.ts wires the Vercel cron entry).
// Idempotency: epochs are keyed by monotonic epoch_number. A second call for
// the same window becomes a no-op if the N+1 row already exists.

import { createHash } from "crypto";
import { asc, desc, gt } from "drizzle-orm";
import { db } from "../db.js";
import {
  auditEvents,
  epochRoots,
  type InsertEpochRoot,
  type Rfc3161Token,
} from "../../shared/schema.js";
import {
  computeMerkleRoot,
  canonicalEpochBytes,
  hashEpochCanonical,
} from "../lib/merkle-tree.js";
import {
  DEFAULT_TSAS,
  fanoutRfc3161,
  publishToRekor,
  backupToR2,
  R2BackupUnavailableError,
  RekorEd25519NotSupportedError,
} from "../lib/anchors.js";
import { createSignerFromEnv, type Signer } from "../lib/signer.js";
import { safeError, safeLog } from "../middleware/log-redactor.js";

interface PublishResult {
  epoch_id: string;
  epoch_number: number;
  merkle_root: string;
  tree_size: number;
  anchor_status: Record<string, "ok" | "failed" | "unavailable">;
}

export async function publishEpoch(signer?: Signer): Promise<PublishResult> {
  const activeSigner = signer ?? createSignerFromEnv();

  // 1. Find the previous epoch (if any) to compute the new epoch number + hash chain.
  const prev = await db.select().from(epochRoots).orderBy(desc(epochRoots.epochNumber)).limit(1);
  const prevEpoch = prev[0];
  const nextEpochNumber = (prevEpoch?.epochNumber ?? 0) + 1;
  const previousEpochCanonicalHash = prevEpoch
    ? hashEpochCanonical(canonicalEpochBytes({
        epochNumber: prevEpoch.epochNumber,
        merkleRoot: prevEpoch.merkleRoot,
        treeSize: prevEpoch.treeSize,
        previousEpochHash: prevEpoch.previousEpochHash,
        publishedAtIsoSeconds: Math.floor(prevEpoch.publishedAt.getTime() / 1000),
      }))
    : null;

  // 2. Collect events since the previous epoch's cutoff timestamp.
  //    For epoch 1, include all events so far. For N+1, include events with
  //    audit_events.timestamp > prevEpoch.publishedAt.
  const eventsQuery = prevEpoch
    ? db.select().from(auditEvents).where(gt(auditEvents.timestamp, prevEpoch.publishedAt)).orderBy(asc(auditEvents.timestamp))
    : db.select().from(auditEvents).orderBy(asc(auditEvents.timestamp));
  const events = await eventsQuery;

  // 3. Merkle root over event_hash values.
  const leaves = events.map((e) => Buffer.from(e.eventHash, "hex"));
  const merkleRoot = computeMerkleRoot(leaves);
  const treeSize = events.length;

  // 4. Canonicalize + sign.
  const publishedAt = new Date();
  const canonical = canonicalEpochBytes({
    epochNumber: nextEpochNumber,
    merkleRoot,
    treeSize,
    previousEpochHash: previousEpochCanonicalHash,
    publishedAtIsoSeconds: Math.floor(publishedAt.getTime() / 1000),
  });
  const canonicalSha256Hex = createHash("sha256").update(canonical).digest("hex");
  const signature = await activeSigner.sign(canonical);
  const signatureB64 = signature.toString("base64");
  const signatureB64Url = signatureB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // 5. Fan out to external anchors in parallel (non-blocking per anchor).
  const anchorStatus: Record<string, "ok" | "failed" | "unavailable"> = {};
  const rfc3161Tokens: Rfc3161Token[] = [];
  let rekorLogId: string | null = null;
  let rekorInclusionProof: unknown = null;
  let r2BackupKey: string | null = null;

  const [tsaOutcome, rekorOutcome, r2Outcome] = await Promise.allSettled([
    fanoutRfc3161(canonicalSha256Hex, DEFAULT_TSAS),
    publishToRekor({
      payloadSha256Hex: canonicalSha256Hex,
      signatureB64,
      publicKeyPem: activeSigner.publicKeyPem(),
      signerAlgorithm: activeSigner.algorithm(),
    }),
    backupToR2({ epochNumber: nextEpochNumber, canonicalBytes: canonical, signatureB64 }),
  ]);

  // TSA results
  if (tsaOutcome.status === "fulfilled") {
    for (const t of tsaOutcome.value.tokens) rfc3161Tokens.push(t);
    for (const name of DEFAULT_TSAS.map((t) => t.name)) {
      anchorStatus[name === "sigstore" ? "sigstore_tsa" : name] =
        tsaOutcome.value.failures[name] ? "failed" : "ok";
    }
    if (Object.keys(tsaOutcome.value.failures).length > 0) {
      safeError("[EPOCH_PUB_TSA_FAILURES]", tsaOutcome.value.failures);
    }
  } else {
    for (const t of DEFAULT_TSAS) anchorStatus[t.name === "sigstore" ? "sigstore_tsa" : t.name] = "failed";
    safeError("[EPOCH_PUB_TSA_FAILURE]", { err: tsaOutcome.reason instanceof Error ? tsaOutcome.reason.message : String(tsaOutcome.reason) });
  }

  // Rekor result
  if (rekorOutcome.status === "fulfilled") {
    rekorLogId = rekorOutcome.value.log_id;
    rekorInclusionProof = rekorOutcome.value.inclusion_proof;
    anchorStatus.rekor = "ok";
  } else {
    const err = rekorOutcome.reason;
    anchorStatus.rekor = err instanceof RekorEd25519NotSupportedError ? "unavailable" : "failed";
    if (anchorStatus.rekor === "failed") {
      safeError("[EPOCH_PUB_REKOR_FAILURE]", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  // R2 result
  if (r2Outcome.status === "fulfilled") {
    r2BackupKey = r2Outcome.value.r2_key;
    anchorStatus.r2_backup = "ok";
  } else {
    const err = r2Outcome.reason;
    anchorStatus.r2_backup = err instanceof R2BackupUnavailableError ? "unavailable" : "failed";
    if (anchorStatus.r2_backup === "failed") {
      safeError("[EPOCH_PUB_R2_FAILURE]", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  // Fail-closed requirement: at least ONE anchor must succeed. Otherwise the
  // epoch has zero tamper-evidence proof beyond our own DB row.
  const successful = Object.entries(anchorStatus).filter(([_, v]) => v === "ok").length;
  if (successful === 0) {
    throw new Error("All external anchors failed — refusing to record epoch");
  }

  // 6. Insert epoch row.
  const toInsert: Omit<InsertEpochRoot, "publishedAt" | "epochId"> = {
    epochNumber: nextEpochNumber,
    merkleRoot,
    treeSize,
    previousEpochHash: previousEpochCanonicalHash,
    signerFingerprint: activeSigner.fingerprint(),
    signerAlgorithm: activeSigner.algorithm(),
    signatureEd25519: signatureB64Url,
    signatureMlDsa: null,
    rfc3161Tokens,
    rekorLogId,
    rekorInclusionProof: rekorInclusionProof as any,
    r2BackupKey,
    anchorStatus,
  };

  const inserted = await db.insert(epochRoots).values({
    ...toInsert,
    publishedAt,
  } as any).returning();

  safeLog("[EPOCH_PUBLISHED]", {
    epoch_number: nextEpochNumber,
    tree_size: treeSize,
    merkle_root_prefix: merkleRoot.substring(0, 16),
    successful_anchors: successful,
    anchor_status: anchorStatus,
  });

  return {
    epoch_id: inserted[0].epochId,
    epoch_number: nextEpochNumber,
    merkle_root: merkleRoot,
    tree_size: treeSize,
    anchor_status: anchorStatus,
  };
}
