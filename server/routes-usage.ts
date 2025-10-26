import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { proofAssets, assetUsage } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { SignJWT, exportJWK } from "jose";

/**
 * Asset usage tracking and usage receipts
 * 
 * Records each usage event and issues signed usage receipt.
 * Can enforce license limits (future enhancement).
 */

const UsageRequest = z.object({
  audience: z.string().optional(),
  nonce: z.string().optional(),
});

// Dev-only usage receipt signer (reuse bootstrap keys or generate ephemeral)
let usageSigningKey: any = null;

async function initUsageSigningKey() {
  if (usageSigningKey) return;

  // For Phase 2 demo: use ephemeral key
  // Phase 3 could integrate with receipt key rotation system
  const { generateKeyPair } = await import("jose");
  const { privateKey } = await generateKeyPair("ES256");
  usageSigningKey = privateKey;
  console.log("[usage-receipts] Generated ephemeral usage signing key");
}

/**
 * Sign usage receipt as JWS
 */
async function signUsageReceipt(payload: any): Promise<string> {
  await initUsageSigningKey();

  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(usageSigningKey);

  return jwt;
}

export function registerUsageRoutes(app: Express) {
  /**
   * POST /api/proof-assets/:id/use
   * 
   * Record usage event and issue signed usage receipt.
   * Future: Can enforce license limits (max uses, expiry, etc.)
   */
  app.post("/api/proof-assets/:id/use", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const body = UsageRequest.parse(req.body);

      // Load asset
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

      // Future enhancement: Check license limits
      // const usageCount = await db.select({ count: sql`count(*)` })
      //   .from(assetUsage)
      //   .where(eq(assetUsage.assetId, id));
      // if (asset.license?.maxUses && usageCount[0].count >= asset.license.maxUses) {
      //   return res.status(403).json({ error: "License usage limit exceeded" });
      // }

      // Record usage event
      const usage = await db
        .insert(assetUsage)
        .values({
          assetId: id,
        })
        .returning();

      // Generate usage receipt (signed JWS)
      const receiptPayload = {
        usage_id: usage[0].usageId,
        asset_id: id,
        issuer_did: asset.issuerDid,
        proof_format: asset.proofFormat,
        used_at: usage[0].usedAt.toISOString(),
        aud: body.audience || "usage-verifier",
        nonce: body.nonce,
      };

      const usageReceipt = await signUsageReceipt(receiptPayload);

      // Create audit event
      const { auditEvents } = await import("@shared/schema");
      const crypto = await import("node:crypto");
      await db.insert(auditEvents).values({
        eventType: "USE",
        assetId: id,
        payload: { usage_id: usage[0].usageId },
        traceId: crypto.randomUUID(),
        eventHash: "", // Will be computed by trigger/service
        previousHash: null,
      });

      return res.json({
        ok: true,
        usage: usage[0],
        receipt: usageReceipt,
        note: "Usage receipt is a signed JWS that can be verified independently",
      });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation failed",
          details: e.errors,
        });
      }
      return res.status(500).json({
        error: "Usage recording failed",
        detail: String(e.message || e),
      });
    }
  });

  /**
   * GET /api/proof-assets/:id/usage
   * 
   * Get usage history for asset
   */
  app.get("/api/proof-assets/:id/usage", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const usages = await db
        .select()
        .from(assetUsage)
        .where(eq(assetUsage.assetId, id))
        .orderBy(assetUsage.usedAt);

      const count = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(assetUsage)
        .where(eq(assetUsage.assetId, id));

      return res.json({
        ok: true,
        assetId: id,
        usages,
        total_uses: count[0]?.count || 0,
      });
    } catch (e: any) {
      return res.status(500).json({
        error: "Failed to fetch usage history",
        detail: String(e.message || e),
      });
    }
  });
}
