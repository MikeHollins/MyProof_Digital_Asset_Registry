import type { Express, Request, Response } from "express";
import { db, pool } from "./db";
import { leafHash, merkleRoot, merkleProof } from "./services/merkle";

/**
 * Audit transparency export endpoints
 * 
 * Provides Merkle root and inclusion proofs for audit events.
 * Enables third-party verification of audit trail integrity.
 */

export function registerAuditExports(app: Express) {
  /**
   * GET /api/audit/events
   * 
   * Returns recent audit events with optional search and pagination.
   * Useful for browsing audit log and selecting events for proof generation.
   * 
   * @query limit - Max events to return (default: 50, max: 500)
   * @query q - Optional text filter on event_type or asset_id (case-insensitive)
   * @returns Array of recent audit events (PII-free, payload truncated)
   */
  app.get("/api/audit/events", async (req: Request, res: Response) => {
    try {
      let limit = Number(req.query.limit || 50);
      if (!Number.isFinite(limit) || limit <= 0) limit = 50;
      if (limit > 500) limit = 500;

      const q = (req.query.q as string | undefined) || '';

      // Build SQL with optional text filter
      let sql = `
        SELECT event_id, event_type, asset_id, payload, timestamp AS created_at
        FROM audit_events
      `;
      const args: any[] = [];

      if (q) {
        args.push(`%${q}%`);
        sql += ` WHERE (event_type ILIKE $1 OR CAST(asset_id AS TEXT) ILIKE $1)`;
      }

      sql += ` ORDER BY timestamp DESC LIMIT ${limit}`;

      const result = await pool.query(sql, args);
      const rows = (result.rows || []).map((ev: any) => ({
        event_id: ev.event_id,
        event_type: ev.event_type,
        asset_id: ev.asset_id,
        payload_preview: safePreview(ev.payload),
        created_at: ev.created_at,
      }));

      return res.json({ ok: true, rows });
    } catch (error: any) {
      return res.status(500).json({
        error: "Failed to fetch audit events",
        detail: error.message,
      });
    }
  });

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

  /**
   * GET /api/audit/export.csv
   * 
   * Export recent audit events as CSV file.
   * Provides downloadable CSV with event_id, event_type, asset_id, created_at.
   * 
   * @returns CSV file with audit events (max 5000)
   */
  app.get("/api/audit/export.csv", async (_req: Request, res: Response) => {
    try {
      const result = await db.execute(
        `SELECT event_id, event_type, asset_id, timestamp AS created_at 
         FROM audit_events 
         ORDER BY timestamp DESC 
         LIMIT 5000`
      );

      const rows = result.rows || [];
      
      // Build CSV with header
      const header = "event_id,event_type,asset_id,created_at\n";
      const csvRows = rows.map((row: any) => {
        return [
          escapeCsvField(row.event_id),
          escapeCsvField(row.event_type),
          escapeCsvField(row.asset_id),
          escapeCsvField(row.created_at)
        ].join(',');
      }).join("\n");
      
      const csv = header + csvRows;
      
      // Set response headers
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="audit-events.csv"');
      
      return res.send(csv);
    } catch (error: any) {
      return res.status(500).json({
        error: "Failed to export audit events as CSV",
        detail: error.message,
      });
    }
  });

  /**
   * GET /api/audit/export.jsonld
   * 
   * Export recent audit events as JSON-LD.
   * Provides linked data format with semantic context for audit events.
   * 
   * Privacy: Payload fields are redacted, only safe metadata exported.
   * 
   * @returns JSON-LD document with audit events (max 5000)
   */
  app.get("/api/audit/export.jsonld", async (_req: Request, res: Response) => {
    try {
      const result = await db.execute(
        `SELECT event_id, event_type, asset_id, timestamp AS created_at 
         FROM audit_events 
         ORDER BY timestamp DESC 
         LIMIT 5000`
      );

      const rows = result.rows || [];
      
      // Build JSON-LD structure with safe metadata only (no payload)
      const jsonld = {
        "@context": {
          "@vocab": "https://myproof.ai/terms#",
          "event_id": "id",
          "event_type": "type",
          "asset_id": "asset",
          "created_at": "issuedAt"
        },
        "events": rows.map((row: any) => ({
          event_id: row.event_id,
          event_type: row.event_type,
          asset_id: row.asset_id,
          created_at: row.created_at,
        }))
      };
      
      // Set Content-Type header
      res.setHeader("Content-Type", "application/ld+json");
      
      return res.json(jsonld);
    } catch (error: any) {
      return res.status(500).json({
        error: "Failed to export audit events as JSON-LD",
        detail: error.message,
      });
    }
  });
}

/**
 * Helper: Safely truncate payload JSON for preview
 */
function safePreview(payload: any, max = 120): string {
  try {
    const s = JSON.stringify(payload);
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return '';
  }
}

/**
 * Helper: Escape CSV field value
 * Wraps values containing commas, quotes, or newlines in quotes
 * and escapes internal quotes by doubling them
 */
function escapeCsvField(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // If contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
