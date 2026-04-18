import type { Express, Request, Response } from "express";
import { createHash } from "crypto";
import { canonicalize } from "json-canonicalize";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "./db.js";
import { policies, insertPolicySchema, type Policy, type PolicyRule, type TrustLevel } from "../shared/schema.js";
import { apiKeyAuth, requireScopes } from "./middleware/apiKey.js";
import { badRequest, internalError, sendError } from "./utils/errors.js";

// 24-hour delay-lock for policy activation.
// Per §governance: after an admin signs a policy, it does not take effect
// until 24h later. Regulators and merchants can see pending changes in advance.
const DELAY_LOCK_MS = 24 * 60 * 60 * 1000;

// Compute a canonical content address for a policy.
// Format: sha256:<64-char-hex>
// Input: the JSON-canonicalized representation of the policy's semantic fields
// (excludes mutable fields like createdAt/updatedAt/deprecatedAt/approvalSignature).
export function computePolicyCid(semantic: {
  name: string;
  version: string;
  rules: readonly PolicyRule[];
  min_trust_level: TrustLevel;
  ttl_seconds: number;
  jurisdiction: string;
  plain_language: string;
  previous_version_hash: string | null;
}): string {
  const canonical = canonicalize(semantic);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

// Is this policy currently effective (signed + past the 24h delay-lock + not deprecated)?
export function isPolicyActive(policy: Pick<Policy, "effectiveAt" | "deprecatedAt">): boolean {
  if (!policy.effectiveAt) return false;
  if (policy.deprecatedAt && policy.deprecatedAt <= new Date()) return false;
  return policy.effectiveAt <= new Date();
}

export function registerPolicyRoutes(app: Express): void {

  // =========================================================================
  // PUBLIC: GET policy by CID (used by website verify endpoint + regulators)
  // No auth — policies are meant to be publicly auditable.
  // =========================================================================
  app.get("/api/policies/:policyCid", async (req: Request, res: Response) => {
    try {
      const result = await db.select().from(policies).where(eq(policies.policyCid, req.params.policyCid)).limit(1);
      if (result.length === 0) {
        return sendError(req, res, 404, "Policy not found", "POLICY_NOT_FOUND");
      }
      const policy = result[0];
      return res.json({
        ok: true,
        policy: {
          policy_id: policy.policyId,
          policy_cid: policy.policyCid,
          name: policy.name,
          version: policy.version,
          previous_version_hash: policy.previousVersionHash,
          rules: policy.rules,
          min_trust_level: policy.minTrustLevel,
          ttl_seconds: policy.ttlSeconds,
          jurisdiction: policy.jurisdiction,
          plain_language: policy.plainLanguage,
          effective_at: policy.effectiveAt,
          deprecated_at: policy.deprecatedAt,
          active: isPolicyActive(policy),
          created_at: policy.createdAt,
        },
      });
    } catch (e: any) {
      return internalError(req, res, e.message);
    }
  });

  // =========================================================================
  // PUBLIC: GET all active policies (paginated)
  // =========================================================================
  app.get("/api/policies", async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const active = await db
        .select()
        .from(policies)
        .where(and(
          lte(policies.effectiveAt, now),
          or(isNull(policies.deprecatedAt), sql`${policies.deprecatedAt} > NOW()`),
        ))
        .orderBy(desc(policies.effectiveAt));

      return res.json({
        ok: true,
        count: active.length,
        policies: active.map((p) => ({
          policy_cid: p.policyCid,
          name: p.name,
          version: p.version,
          min_trust_level: p.minTrustLevel,
          ttl_seconds: p.ttlSeconds,
          jurisdiction: p.jurisdiction,
          plain_language: p.plainLanguage,
          effective_at: p.effectiveAt,
        })),
      });
    } catch (e: any) {
      return internalError(req, res, e.message);
    }
  });

  // =========================================================================
  // ADMIN: create a new policy (pending; not effective until signed)
  // =========================================================================
  app.post("/api/admin/policies", apiKeyAuth, requireScopes(["admin:*"]), async (req: Request, res: Response) => {
    try {
      const body = insertPolicySchema.parse(req.body);

      // Look up previous version for this policy name to build the hash chain.
      const previous = await db
        .select()
        .from(policies)
        .where(eq(policies.name, body.name))
        .orderBy(desc(policies.createdAt))
        .limit(1);
      const previousVersionHash = previous.length > 0 ? previous[0].policyCid : null;

      // Compute canonical CID from semantic fields.
      const policyCid = computePolicyCid({
        name: body.name,
        version: body.version,
        rules: body.rules,
        min_trust_level: body.minTrustLevel,
        ttl_seconds: body.ttlSeconds,
        jurisdiction: body.jurisdiction,
        plain_language: body.plainLanguage,
        previous_version_hash: previousVersionHash,
      });

      const inserted = await db.insert(policies).values({
        policyCid,
        name: body.name,
        version: body.version,
        previousVersionHash,
        rules: body.rules,
        minTrustLevel: body.minTrustLevel,
        ttlSeconds: body.ttlSeconds,
        jurisdiction: body.jurisdiction,
        plainLanguage: body.plainLanguage,
      }).returning();

      return res.status(201).json({
        ok: true,
        policy: {
          policy_id: inserted[0].policyId,
          policy_cid: inserted[0].policyCid,
          name: inserted[0].name,
          version: inserted[0].version,
          status: "pending_signature",
          message: "Policy created but not yet effective. Call POST /api/admin/policies/:policyId/sign to activate after 24h delay-lock.",
        },
      });
    } catch (e: any) {
      return badRequest(req, res, e.message, "POLICY_CREATE_FAILED");
    }
  });

  // =========================================================================
  // ADMIN: sign a policy to initiate the 24h delay-lock
  // =========================================================================
  app.post("/api/admin/policies/:policyId/sign", apiKeyAuth, requireScopes(["admin:*"]), async (req: Request, res: Response) => {
    try {
      const { signature } = req.body ?? {};
      if (typeof signature !== "string" || signature.length < 32) {
        return badRequest(req, res, "signature required (>= 32 chars, hex or base64)", "SIGNATURE_REQUIRED");
      }

      const now = new Date();
      const effectiveAt = new Date(now.getTime() + DELAY_LOCK_MS);

      const updated = await db
        .update(policies)
        .set({
          approvalSignature: signature,
          approvalSignedAt: now,
          effectiveAt,
          updatedAt: now,
        })
        .where(and(
          eq(policies.policyId, req.params.policyId),
          isNull(policies.approvalSignature),
        ))
        .returning();

      if (updated.length === 0) {
        return sendError(req, res, 404, "Policy not found or already signed", "POLICY_ALREADY_SIGNED_OR_MISSING");
      }

      return res.json({
        ok: true,
        policy_id: updated[0].policyId,
        policy_cid: updated[0].policyCid,
        effective_at: updated[0].effectiveAt,
        delay_lock_hours: 24,
      });
    } catch (e: any) {
      return badRequest(req, res, e.message, "POLICY_SIGN_FAILED");
    }
  });

  // =========================================================================
  // ADMIN: deprecate a policy (existing proofs remain valid; new proofs rejected)
  // =========================================================================
  app.post("/api/admin/policies/:policyId/deprecate", apiKeyAuth, requireScopes(["admin:*"]), async (req: Request, res: Response) => {
    try {
      const now = new Date();
      const updated = await db
        .update(policies)
        .set({ deprecatedAt: now, updatedAt: now })
        .where(eq(policies.policyId, req.params.policyId))
        .returning();

      if (updated.length === 0) {
        return sendError(req, res, 404, "Policy not found", "POLICY_NOT_FOUND");
      }

      return res.json({
        ok: true,
        policy_id: updated[0].policyId,
        policy_cid: updated[0].policyCid,
        deprecated_at: updated[0].deprecatedAt,
      });
    } catch (e: any) {
      return badRequest(req, res, e.message, "POLICY_DEPRECATE_FAILED");
    }
  });

  // =========================================================================
  // ADMIN: list all policies including pending and deprecated
  // =========================================================================
  app.get("/api/admin/policies", apiKeyAuth, requireScopes(["admin:*"]), async (_req: Request, res: Response) => {
    try {
      const all = await db.select().from(policies).orderBy(desc(policies.createdAt));
      return res.json({
        ok: true,
        count: all.length,
        policies: all.map((p) => ({
          ...p,
          active: isPolicyActive(p),
        })),
      });
    } catch (e: any) {
      return internalError(req, res, e.message);
    }
  });
}
