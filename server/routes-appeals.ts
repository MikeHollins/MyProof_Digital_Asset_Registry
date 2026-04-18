// Appeals endpoint — EDPB Statement 1/2025 Art. 22 compliance.
//
// Every rejected verification must offer the user a path to request human
// review. The endpoint takes a STRUCTURED form (no free-form JSON dump):
//   - verification_id (optional, links to the rejected verification if known)
//   - session_id_hint (optional, short identifier — not PII-carrying)
//   - category (enum: incorrect_rejection | technical_error | policy_dispute | other)
//   - free_text (optional, <= 500 chars, PII-scanned on submit)
//
// Any PII detected in free_text flags the appeal for reviewer-only access and
// logs the detection server-side without echoing the content.
//
// SLA: resolved within 30 days per EDPB guidance.

import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { appeals, submitAppealSchema } from "../shared/schema.js";
import { apiKeyAuth, requireScopes } from "./middleware/apiKey.js";
import { badRequest, internalError, sendError } from "./utils/errors.js";
import { safeError, safeLog, redactForLog } from "./middleware/log-redactor.js";

// Reuse the same PII pattern set as envelope/log-redactor, stripped and
// case/NFKC-normalized at check time. Any hit flags the appeal but DOES NOT
// expose the PII content — the submitter's free-text is stored encrypted-at-rest
// by default via Neon, and only reviewers with restricted access retrieve it.
const PII_DETECTORS: readonly { pattern: RegExp; tag: string }[] = [
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/, tag: "EMAIL" },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, tag: "SSN" },
  { pattern: /\b\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, tag: "PHONE" },
  { pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, tag: "CREDIT_CARD" },
  { pattern: /\b(19|20)\d{2}[-\/](0[1-9]|1[012])[-\/](0[1-9]|[12]\d|3[01])\b/, tag: "DOB_ISO" },
  { pattern: /\b(0[1-9]|1[012])[-\/](0[1-9]|[12]\d|3[01])[-\/](19|20)\d{2}\b/, tag: "DOB_US" },
];

interface PiiScanResult {
  flagged: boolean;
  tags: string[];
}

function scanFreeTextForPii(text: string): PiiScanResult {
  const normalized = text.normalize("NFKC");
  const tags: string[] = [];
  for (const { pattern, tag } of PII_DETECTORS) {
    if (pattern.test(normalized)) tags.push(tag);
  }
  return { flagged: tags.length > 0, tags };
}

const APPEAL_SLA_DAYS = 30;

export function registerAppealRoutes(app: Express): void {

  // ---------------------------------------------------------------------
  // PUBLIC: submit an appeal. Rate-limited per-IP is expected at the edge
  // (Vercel WAF) but we also structurally constrain the form.
  // ---------------------------------------------------------------------
  app.post("/api/appeal", async (req: Request, res: Response) => {
    try {
      const parsed = submitAppealSchema.safeParse(req.body);
      if (!parsed.success) {
        return badRequest(req, res, parsed.error.issues[0]?.message ?? "invalid form", "APPEAL_FORM_INVALID");
      }
      const input = parsed.data;

      // PII scan on free_text (if provided). Flag but do not reject.
      let piiFlagged = false;
      let piiTags: string[] = [];
      if (input.free_text && input.free_text.length > 0) {
        const scan = scanFreeTextForPii(input.free_text);
        piiFlagged = scan.flagged;
        piiTags = scan.tags;
      }

      const now = new Date();
      const slaDueAt = new Date(now.getTime() + APPEAL_SLA_DAYS * 24 * 60 * 60 * 1000);

      const inserted = await db.insert(appeals).values({
        verificationId: input.verification_id ?? null,
        sessionIdHint: input.session_id_hint ?? null,
        category: input.category,
        freeText: input.free_text ?? null,
        piiFlagged,
        status: "open",
        slaDueAt,
      }).returning({ appealId: appeals.appealId });

      // Log without echoing PII content — only metadata.
      safeLog("[APPEAL_SUBMITTED]", {
        appeal_id: inserted[0].appealId,
        category: input.category,
        has_free_text: Boolean(input.free_text),
        pii_flagged: piiFlagged,
        pii_tags: piiTags,
        sla_due_at: slaDueAt,
      });

      return res.status(201).json({
        ok: true,
        appeal_id: inserted[0].appealId,
        sla_due_at: slaDueAt,
        message: "Appeal received. Human review within 30 days.",
      });
    } catch (e) {
      safeError("[APPEAL_SUBMIT_ERROR]", { err: e instanceof Error ? e.message : String(e) });
      return internalError(req, res, "Appeal submission failed");
    }
  });

  // ---------------------------------------------------------------------
  // ADMIN: reviewer queue — list open + in_review appeals sorted by SLA.
  // Restricted to appeals:review scope so only trained reviewers see
  // PII-flagged content.
  // ---------------------------------------------------------------------
  app.get("/api/admin/appeals", apiKeyAuth, requireScopes(["appeals:review", "admin:*"]), async (req: Request, res: Response) => {
    try {
      const status = String(req.query.status ?? "open");
      const rows = await db.select().from(appeals).orderBy(appeals.slaDueAt);
      const filtered = rows.filter((a) => status === "all" || a.status === status);
      return res.json({
        ok: true,
        count: filtered.length,
        appeals: filtered.map((a) => ({
          appeal_id: a.appealId,
          verification_id: a.verificationId,
          session_id_hint: a.sessionIdHint,
          category: a.category,
          // free_text omitted from list view; reviewer must open the detail
          // view to read it. Reduces accidental exposure.
          pii_flagged: a.piiFlagged,
          status: a.status,
          assigned_reviewer: a.assignedReviewer,
          sla_due_at: a.slaDueAt,
          created_at: a.createdAt,
        })),
      });
    } catch (e) {
      safeError("[APPEAL_LIST_ERROR]", { err: e instanceof Error ? e.message : String(e) });
      return internalError(req, res, "Appeal list failed");
    }
  });

  // ---------------------------------------------------------------------
  // ADMIN: read a single appeal including free_text. Redacted per redactor
  // if PII was flagged — reviewer UI can request unredacted via a specific
  // explicit flag.
  // ---------------------------------------------------------------------
  app.get("/api/admin/appeals/:appealId", apiKeyAuth, requireScopes(["appeals:review", "admin:*"]), async (req: Request, res: Response) => {
    try {
      const rows = await db.select().from(appeals).where(eq(appeals.appealId, req.params.appealId)).limit(1);
      if (rows.length === 0) return sendError(req, res, 404, "Appeal not found", "APPEAL_NOT_FOUND");
      const a = rows[0];
      const unredact = req.query.unredact === "true";
      return res.json({
        ok: true,
        appeal: {
          appeal_id: a.appealId,
          verification_id: a.verificationId,
          session_id_hint: a.sessionIdHint,
          category: a.category,
          free_text: a.piiFlagged && !unredact
            ? redactForLog(a.freeText)
            : a.freeText,
          pii_flagged: a.piiFlagged,
          status: a.status,
          assigned_reviewer: a.assignedReviewer,
          resolution: a.resolution,
          resolved_at: a.resolvedAt,
          sla_due_at: a.slaDueAt,
          created_at: a.createdAt,
          updated_at: a.updatedAt,
        },
      });
    } catch (e) {
      safeError("[APPEAL_DETAIL_ERROR]", { err: e instanceof Error ? e.message : String(e) });
      return internalError(req, res, "Appeal detail failed");
    }
  });

  // ---------------------------------------------------------------------
  // ADMIN: resolve an appeal (assigned_reviewer + resolution + status).
  // ---------------------------------------------------------------------
  app.post("/api/admin/appeals/:appealId/resolve", apiKeyAuth, requireScopes(["appeals:review", "admin:*"]), async (req: Request, res: Response) => {
    try {
      const body = req.body as { resolution?: unknown; outcome?: unknown; reviewer?: unknown } | undefined;
      const resolution = typeof body?.resolution === "string" && body.resolution.length >= 10 ? body.resolution : null;
      const outcome = body?.outcome === "resolved" || body?.outcome === "rejected" ? body.outcome : null;
      const reviewer = typeof body?.reviewer === "string" && body.reviewer.length >= 2 ? body.reviewer : null;
      if (!resolution || !outcome || !reviewer) {
        return badRequest(req, res, "resolution (>=10 chars), outcome ('resolved'|'rejected'), reviewer (>=2 chars) required", "APPEAL_RESOLVE_MISSING_FIELDS");
      }

      const now = new Date();
      const updated = await db
        .update(appeals)
        .set({
          status: outcome,
          resolution,
          assignedReviewer: reviewer,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(appeals.appealId, req.params.appealId))
        .returning({ appealId: appeals.appealId, status: appeals.status });

      if (updated.length === 0) return sendError(req, res, 404, "Appeal not found", "APPEAL_NOT_FOUND");
      return res.json({ ok: true, appeal_id: updated[0].appealId, status: updated[0].status, resolved_at: now });
    } catch (e) {
      safeError("[APPEAL_RESOLVE_ERROR]", { err: e instanceof Error ? e.message : String(e) });
      return internalError(req, res, "Appeal resolve failed");
    }
  });
}
