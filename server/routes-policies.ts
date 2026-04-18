import type { Express, Request, Response } from "express";
import { createHash, createPublicKey, verify as cryptoVerify } from "crypto";
import { canonicalize } from "json-canonicalize";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "./db.js";
import { policies, insertPolicySchema, type Policy, type PolicyRule, type TrustLevel } from "../shared/schema.js";
import { apiKeyAuth, requireScopes } from "./middleware/apiKey.js";
import { badRequest, internalError, sendError } from "./utils/errors.js";
import { safeError } from "./middleware/log-redactor.js";

// 24-hour delay-lock for policy activation.
// Per §governance: after an admin signs a policy, it does not take effect
// until 24h later. Regulators and merchants can see pending changes in advance.
const DELAY_LOCK_MS = 24 * 60 * 60 * 1000;

// Admin signing key — Ed25519 public key in SPKI PEM format.
// Stored in env var POLICY_ADMIN_PUBKEY_PEM. Phase 1 uses a locally-held
// Ed25519 keypair; Phase 2 upgrades to AWS KMS-backed signing with an
// identical verify path (KMS keys export an SPKI PEM pubkey).
// Fail-closed if the env var is missing — /sign endpoint returns 503.
function getAdminPubkey(): { key: ReturnType<typeof createPublicKey>; fingerprint: string } | null {
  const pem = process.env.POLICY_ADMIN_PUBKEY_PEM;
  if (!pem) return null;
  try {
    const key = createPublicKey(pem);
    const fingerprint = createHash("sha256").update(pem).digest("hex").substring(0, 16);
    return { key, fingerprint };
  } catch {
    return null;
  }
}

// Safe redact of a db/runtime error before it reaches the client.
// Per security review: e.message may leak SQL, table/column names, or host info.
function sanitizeError(e: unknown, fallback: string): string {
  if (e instanceof Error) {
    const msg = e.message ?? "";
    // Strip anything that looks like a SQL hint, path, or db identifier.
    if (/(\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bFROM\b|relation\s|\bcolumn\b|neondb|postgres|localhost|:5432|\.sql\b)/i.test(msg)) {
      return fallback;
    }
    return msg.length > 200 ? msg.substring(0, 200) : msg;
  }
  return fallback;
}

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
    } catch (e) {
      safeError("[POLICY_GET_BY_CID_ERROR]", { trace_id: (req as any).traceId, err: e instanceof Error ? e.message : String(e) });
      return internalError(req, res, sanitizeError(e, "Policy lookup failed"));
    }
  });

  // =========================================================================
  // PUBLIC: GET active policies (paginated, default limit 100, max 500)
  // =========================================================================
  app.get("/api/policies", async (req: Request, res: Response) => {
    try {
      const limitRaw = Number.parseInt(String((req.query as any)?.limit ?? "100"), 10);
      const offsetRaw = Number.parseInt(String((req.query as any)?.offset ?? "0"), 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
      const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

      const now = new Date();
      const active = await db
        .select()
        .from(policies)
        .where(and(
          lte(policies.effectiveAt, now),
          or(isNull(policies.deprecatedAt), sql`${policies.deprecatedAt} > NOW()`),
        ))
        .orderBy(desc(policies.effectiveAt))
        .limit(limit)
        .offset(offset);

      return res.json({
        ok: true,
        count: active.length,
        limit,
        offset,
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
    } catch (e) {
      safeError("[POLICY_LIST_ERROR]", { trace_id: (req as any).traceId, err: e instanceof Error ? e.message : String(e) });
      return internalError(req, res, sanitizeError(e, "Policy list failed"));
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
    } catch (e) {
      safeError("[POLICY_CREATE_ERROR]", { trace_id: (req as any).traceId, err: e instanceof Error ? e.message : String(e) });
      return badRequest(req, res, sanitizeError(e, "Policy create failed"), "POLICY_CREATE_FAILED");
    }
  });

  // =========================================================================
  // ADMIN: sign a policy to initiate the 24h delay-lock
  //
  // Body: { signature: "<base64url Ed25519 signature over the policy_cid bytes>" }
  // Verification: the signature must verify against the admin Ed25519 pubkey
  // published in env var POLICY_ADMIN_PUBKEY_PEM. If the env var is missing
  // or the signature fails to verify, the endpoint fails closed.
  //
  // Phase 2 upgrade: POLICY_ADMIN_PUBKEY_PEM will be the SPKI PEM of an AWS
  // KMS-backed Ed25519 key. Verification path is identical; only the signing
  // side moves off the admin laptop and into KMS.
  // =========================================================================
  app.post("/api/admin/policies/:policyId/sign", apiKeyAuth, requireScopes(["admin:*"]), async (req: Request, res: Response) => {
    try {
      const pubkey = getAdminPubkey();
      if (!pubkey) {
        // Fail-closed: no admin pubkey configured => no policy can be signed.
        return sendError(req, res, 503, "Admin signing key not configured (POLICY_ADMIN_PUBKEY_PEM missing or malformed)", "ADMIN_PUBKEY_UNAVAILABLE");
      }

      const body = req.body as { signature?: unknown } | undefined;
      const signatureInput = body?.signature;
      if (typeof signatureInput !== "string" || signatureInput.length < 32) {
        return badRequest(req, res, "signature required (base64url Ed25519 over policy_cid bytes)", "SIGNATURE_REQUIRED");
      }

      // Fetch the policy and check it is not already signed.
      const target = await db.select().from(policies).where(eq(policies.policyId, req.params.policyId)).limit(1);
      if (target.length === 0) {
        return sendError(req, res, 404, "Policy not found", "POLICY_NOT_FOUND");
      }
      if (target[0].approvalSignature) {
        return sendError(req, res, 409, "Policy already signed — issue a new version to update rules", "POLICY_ALREADY_SIGNED");
      }

      // Decode base64url signature.
      let signatureBytes: Buffer;
      try {
        const normalized = signatureInput.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
        signatureBytes = Buffer.from(padded, "base64");
      } catch {
        return badRequest(req, res, "signature must be base64url-encoded", "SIGNATURE_DECODE_FAILED");
      }
      if (signatureBytes.length !== 64) {
        return badRequest(req, res, `Ed25519 signature must be 64 bytes; got ${signatureBytes.length}`, "SIGNATURE_LENGTH_INVALID");
      }

      // Ed25519 verify over the policy_cid ASCII bytes.
      const messageBytes = Buffer.from(target[0].policyCid, "utf8");
      const ok = cryptoVerify(null, messageBytes, pubkey.key, signatureBytes);
      if (!ok) {
        return sendError(req, res, 403, "Signature does not verify against admin pubkey", "SIGNATURE_INVALID");
      }

      const now = new Date();
      const effectiveAt = new Date(now.getTime() + DELAY_LOCK_MS);
      const updated = await db
        .update(policies)
        .set({
          approvalSignature: signatureInput,
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
        // Race: someone else signed in between our check and update.
        return sendError(req, res, 409, "Policy signed by a concurrent request", "POLICY_CONCURRENT_SIGN");
      }

      return res.json({
        ok: true,
        policy_id: updated[0].policyId,
        policy_cid: updated[0].policyCid,
        effective_at: updated[0].effectiveAt,
        delay_lock_hours: 24,
        admin_pubkey_fingerprint: pubkey.fingerprint,
      });
    } catch (e) {
      safeError("[POLICY_SIGN_ERROR]", { trace_id: (req as any).traceId, err: e instanceof Error ? e.message : String(e) });
      return badRequest(req, res, sanitizeError(e, "Policy sign failed"), "POLICY_SIGN_FAILED");
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
    } catch (e) {
      safeError("[POLICY_DEPRECATE_ERROR]", { trace_id: (req as any).traceId, err: e instanceof Error ? e.message : String(e) });
      return badRequest(req, res, sanitizeError(e, "Policy deprecate failed"), "POLICY_DEPRECATE_FAILED");
    }
  });

  // =========================================================================
  // ADMIN: list all policies including pending and deprecated
  // =========================================================================
  app.get("/api/admin/policies", apiKeyAuth, requireScopes(["admin:*"]), async (req: Request, res: Response) => {
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
    } catch (e) {
      safeError("[POLICY_ADMIN_LIST_ERROR]", { trace_id: (req as any).traceId, err: e instanceof Error ? e.message : String(e) });
      return internalError(req, res, sanitizeError(e, "Policy admin list failed"));
    }
  });
}
