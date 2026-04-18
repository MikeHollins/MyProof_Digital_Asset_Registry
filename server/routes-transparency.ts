// Public transparency endpoints — no auth required. Anyone can read epoch
// roots, anchor attestations, and the current tree head to independently
// verify the append-only property of the audit ledger.
//
// Phase 2 endpoints:
//   GET /api/transparency/epoch/latest       — most recent signed epoch
//   GET /api/transparency/epoch/:epochNumber — specific epoch by number
//   GET /api/transparency/epochs             — paginated list
//   POST /api/cron/publish-epoch             — cron handler (protected by
//                                              CRON_SECRET header) to trigger
//                                              a new epoch publish
//
// The client-side verifier (built in Phase 7) consumes these endpoints plus
// server/lib/merkle-tree.ts verifyInclusionProof to validate without
// round-tripping to MyProof.

import type { Express, Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "./db.js";
import { epochRoots } from "../shared/schema.js";
import { safeError } from "./middleware/log-redactor.js";
import { publishEpoch } from "./cron/epoch-publisher.js";

export function registerTransparencyRoutes(app: Express): void {

  // ---------------------------------------------------------------------
  // PUBLIC: latest epoch
  // ---------------------------------------------------------------------
  app.get("/api/transparency/epoch/latest", async (_req: Request, res: Response) => {
    try {
      const rows = await db.select().from(epochRoots).orderBy(desc(epochRoots.epochNumber)).limit(1);
      if (rows.length === 0) {
        return res.status(404).json({ ok: false, error: "NO_EPOCHS_YET", message: "No epoch has been published" });
      }
      const e = rows[0];
      return res.json({
        ok: true,
        epoch: {
          epoch_number: e.epochNumber,
          merkle_root: e.merkleRoot,
          tree_size: e.treeSize,
          previous_epoch_hash: e.previousEpochHash,
          signer_fingerprint: e.signerFingerprint,
          signer_algorithm: e.signerAlgorithm,
          signature_ed25519: e.signatureEd25519,
          signature_ml_dsa: e.signatureMlDsa,
          rfc_3161_tokens: e.rfc3161Tokens,
          rekor_log_id: e.rekorLogId,
          rekor_inclusion_proof: e.rekorInclusionProof,
          r2_backup_key: e.r2BackupKey,
          anchor_status: e.anchorStatus,
          published_at: e.publishedAt,
        },
      });
    } catch (err) {
      safeError("[TRANSPARENCY_LATEST_ERROR]", { err: err instanceof Error ? err.message : String(err) });
      return res.status(500).json({ ok: false, error: "INTERNAL", message: "Failed to load latest epoch" });
    }
  });

  // ---------------------------------------------------------------------
  // PUBLIC: specific epoch by number
  // ---------------------------------------------------------------------
  app.get("/api/transparency/epoch/:epochNumber", async (req: Request, res: Response) => {
    const n = Number.parseInt(req.params.epochNumber, 10);
    if (!Number.isFinite(n) || n < 1) {
      return res.status(400).json({ ok: false, error: "BAD_EPOCH_NUMBER" });
    }
    try {
      const rows = await db.select().from(epochRoots).where(eq(epochRoots.epochNumber, n)).limit(1);
      if (rows.length === 0) {
        return res.status(404).json({ ok: false, error: "EPOCH_NOT_FOUND" });
      }
      const e = rows[0];
      return res.json({
        ok: true,
        epoch: {
          epoch_number: e.epochNumber,
          merkle_root: e.merkleRoot,
          tree_size: e.treeSize,
          previous_epoch_hash: e.previousEpochHash,
          signer_fingerprint: e.signerFingerprint,
          signer_algorithm: e.signerAlgorithm,
          signature_ed25519: e.signatureEd25519,
          signature_ml_dsa: e.signatureMlDsa,
          rfc_3161_tokens: e.rfc3161Tokens,
          rekor_log_id: e.rekorLogId,
          rekor_inclusion_proof: e.rekorInclusionProof,
          r2_backup_key: e.r2BackupKey,
          anchor_status: e.anchorStatus,
          published_at: e.publishedAt,
        },
      });
    } catch (err) {
      safeError("[TRANSPARENCY_BY_NUMBER_ERROR]", { err: err instanceof Error ? err.message : String(err), epoch_number: n });
      return res.status(500).json({ ok: false, error: "INTERNAL" });
    }
  });

  // ---------------------------------------------------------------------
  // PUBLIC: paginated list
  // ---------------------------------------------------------------------
  app.get("/api/transparency/epochs", async (req: Request, res: Response) => {
    const limitRaw = Number.parseInt(String((req.query as any)?.limit ?? "50"), 10);
    const offsetRaw = Number.parseInt(String((req.query as any)?.offset ?? "0"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
    try {
      const rows = await db.select({
        epochNumber: epochRoots.epochNumber,
        merkleRoot: epochRoots.merkleRoot,
        treeSize: epochRoots.treeSize,
        signerFingerprint: epochRoots.signerFingerprint,
        anchorStatus: epochRoots.anchorStatus,
        publishedAt: epochRoots.publishedAt,
      }).from(epochRoots).orderBy(desc(epochRoots.epochNumber)).limit(limit).offset(offset);
      return res.json({
        ok: true,
        count: rows.length,
        limit,
        offset,
        epochs: rows.map((r) => ({
          epoch_number: r.epochNumber,
          merkle_root: r.merkleRoot,
          tree_size: r.treeSize,
          signer_fingerprint: r.signerFingerprint,
          anchor_status: r.anchorStatus,
          published_at: r.publishedAt,
        })),
      });
    } catch (err) {
      safeError("[TRANSPARENCY_LIST_ERROR]", { err: err instanceof Error ? err.message : String(err) });
      return res.status(500).json({ ok: false, error: "INTERNAL" });
    }
  });

  // ---------------------------------------------------------------------
  // CRON: publish next epoch. Protected by CRON_SECRET.
  //
  // Vercel cron hits this endpoint via GET with the Authorization: Bearer <secret>
  // header (automatically injected from the CRON_SECRET env var). We accept
  // both GET (Vercel's default) and POST (manual triggers / internal tests).
  // ---------------------------------------------------------------------
  const cronHandler = async (req: Request, res: Response) => {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      return res.status(503).json({ ok: false, error: "CRON_SECRET_NOT_CONFIGURED" });
    }
    const auth = req.headers.authorization;
    const provided = auth?.startsWith("Bearer ")
      ? auth.slice(7)
      : (req.headers["x-cron-secret"] as string | undefined);
    if (!provided || provided !== expected) {
      return res.status(403).json({ ok: false, error: "CRON_SECRET_INVALID" });
    }
    try {
      const result = await publishEpoch();
      return res.json({ ok: true, ...result });
    } catch (err) {
      safeError("[EPOCH_CRON_FAILURE]", { err: err instanceof Error ? err.message : String(err) });
      return res.status(500).json({ ok: false, error: "EPOCH_PUBLISH_FAILED" });
    }
  };
  app.get("/api/cron/publish-epoch", cronHandler);
  app.post("/api/cron/publish-epoch", cronHandler);
}
