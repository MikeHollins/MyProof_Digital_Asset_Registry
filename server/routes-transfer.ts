import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { proofAssets, assetTransfers } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Asset transfer and provenance tracking
 * 
 * Enables ownership transfers with full audit trail.
 * Each transfer updates issuerDid and records provenance.
 */

const TransferRequest = z.object({
  to_did: z.string().min(3, "DID must be at least 3 characters"),
});

export function registerTransferRoutes(app: Express) {
  /**
   * POST /api/proof-assets/:id/transfer
   * 
   * Transfer ownership of proof asset to new DID.
   * Records transfer in provenance table and updates issuerDid.
   */
  app.post("/api/proof-assets/:id/transfer", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const body = TransferRequest.parse(req.body);

      // Load current asset
      const assets = await db
        .select()
        .from(proofAssets)
        .where(eq(proofAssets.proofAssetId, id))
        .limit(1);

      if (assets.length === 0) {
        return res.status(404).json({
          error: "Asset not found",
          assetId: id,
        });
      }

      const asset = assets[0];
      const fromDid = asset.issuerDid;
      const toDid = body.to_did;

      // Validate transfer (prevent self-transfer)
      if (fromDid === toDid) {
        return res.status(400).json({
          error: "Cannot transfer to same DID",
          fromDid,
          toDid,
        });
      }

      // Update asset ownership
      await db
        .update(proofAssets)
        .set({
          issuerDid: toDid,
          updatedAt: new Date(),
        })
        .where(eq(proofAssets.proofAssetId, id));

      // Record transfer in provenance table
      const transfer = await db
        .insert(assetTransfers)
        .values({
          assetId: id,
          fromDid,
          toDid,
        })
        .returning();

      // Create audit event
      const { auditEvents } = await import("@shared/schema");
      const crypto = await import("node:crypto");
      await db.insert(auditEvents).values({
        eventType: "TRANSFER",
        assetId: id,
        payload: { from_did: fromDid, to_did: toDid },
        traceId: crypto.randomUUID(),
        eventHash: "", // Will be computed by trigger/service
        previousHash: null,
      });

      return res.json({
        ok: true,
        assetId: id,
        transfer: transfer[0],
        from_did: fromDid,
        to_did: toDid,
      });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation failed",
          details: e.errors,
        });
      }
      return res.status(500).json({
        error: "Transfer failed",
        detail: String(e.message || e),
      });
    }
  });

  /**
   * GET /api/proof-assets/:id/transfers
   * 
   * Get transfer history (provenance chain) for asset
   */
  app.get("/api/proof-assets/:id/transfers", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const transfers = await db
        .select()
        .from(assetTransfers)
        .where(eq(assetTransfers.assetId, id))
        .orderBy(assetTransfers.createdAt);

      return res.json({
        ok: true,
        assetId: id,
        transfers,
        count: transfers.length,
      });
    } catch (e: any) {
      return res.status(500).json({
        error: "Failed to fetch transfers",
        detail: String(e.message || e),
      });
    }
  });
}
