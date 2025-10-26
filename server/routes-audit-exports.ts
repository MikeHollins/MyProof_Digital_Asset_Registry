import type { Express, Request, Response } from "express";
import { db } from "./db";
import { leafHash, merkleRoot, merkleProof } from "./services/merkle";

/**
 * Audit transparency export endpoints
 * 
 * Provides Merkle root and inclusion proofs for audit events.
 * Enables third-party verification of audit trail integrity.
 */

export function registerAuditExports(app: Express) {
  /**
   * GET /api/audit/root
   * 
   * Returns Merkle root hash computed over recent audit events.
   * Demo: Last 10k events for performance
   * Production: Would use incremental Merkle tree with persistent snapshots
   */
  app.get("/api/audit/root", async (_req: Request, res: Response) => {
    try {
      const result = await db.execute(
        `SELECT event_id, event_type, asset_id, payload, timestamp AS created_at 
         FROM audit_events 
         ORDER BY timestamp ASC 
         LIMIT 10000`
      );

      const rows = result.rows || [];
      const leaves = rows.map((ev: any) => leafHash(ev));
      const root = merkleRoot(leaves);

      return res.json({
        ok: true,
        count: leaves.length,
        root: Buffer.from(root).toString("hex"),
        algorithm: "sha2-256",
        note: "Demo: computed over last 10k events. Production would use persistent snapshots.",
      });
    } catch (error: any) {
      return res.status(500).json({
        error: "Failed to compute Merkle root",
        detail: error.message,
      });
    }
  });

  /**
   * GET /api/audit/proof/:eventId
   * 
   * Returns Merkle inclusion proof for specific audit event.
   * Proof can be independently verified against published root.
   * 
   * @param eventId - UUID of audit event
   * @returns Inclusion proof (array of sibling hashes) and root
   */
  app.get("/api/audit/proof/:eventId", async (req: Request, res: Response) => {
    try {
      const result = await db.execute(
        `SELECT event_id, event_type, asset_id, payload, timestamp AS created_at 
         FROM audit_events 
         ORDER BY timestamp ASC 
         LIMIT 10000`
      );

      const rows = result.rows || [];
      const leaves = rows.map((ev: any) => leafHash(ev));

      // Find event index
      const eventIndex = rows.findIndex((ev: any) => ev.event_id === req.params.eventId);

      if (eventIndex === -1) {
        return res.status(404).json({
          error: "Event not found",
          detail: `Event ${req.params.eventId} not found in recent events`,
        });
      }

      // Generate inclusion proof
      const proof = merkleProof(leaves, eventIndex).map((hash) =>
        Buffer.from(hash).toString("hex")
      );
      const root = merkleRoot(leaves);

      return res.json({
        ok: true,
        eventId: req.params.eventId,
        eventIndex,
        leaf: Buffer.from(leaves[eventIndex]).toString("hex"),
        root: Buffer.from(root).toString("hex"),
        proof,
        algorithm: "sha2-256",
        verification: {
          instructions: [
            "1. Hash your event data using SHA-256",
            "2. For each proof element (sibling hash):",
            "   - If eventIndex is even: hash(current, sibling)",
            "   - If eventIndex is odd: hash(sibling, current)",
            "   - Update index = floor(index / 2)",
            "3. Final hash should equal root",
          ],
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        error: "Failed to generate Merkle proof",
        detail: error.message,
      });
    }
  });
}
