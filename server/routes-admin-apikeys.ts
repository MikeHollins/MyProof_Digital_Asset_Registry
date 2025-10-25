import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { partners, apiKeys } from "@shared/schema";
import { issueApiKey, revokeApiKey, rotateApiKey, type Scope } from "./services/apiKeys";
import { requireScopes, apiKeyAuth } from "./middleware/apiKey";
import { eq } from "drizzle-orm";

const PartnerCreate = z.object({
  name: z.string().min(2),
  contactEmail: z.string().email().optional()
});

const scopeEnum = z.enum(['assets:mint', 'assets:read', 'status:update', 'transfer:execute', 'audit:read', 'admin:*']);

const IssueKey = z.object({
  partnerId: z.string().uuid(),
  scopes: z.array(scopeEnum).nonempty(),
  notAfter: z.string().datetime().optional()
});

export function registerAdminApiKeys(app: Express) {
  app.post('/api/admin/partners', apiKeyAuth, requireScopes(['admin:*']), async (req: Request, res: Response) => {
    try {
      const body = PartnerCreate.parse(req.body);
      const r = await db.insert(partners).values({ 
        name: body.name, 
        contactEmail: body.contactEmail || null 
      }).returning();
      
      return res.json({ ok: true, partner: r[0] });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/admin/partners', apiKeyAuth, requireScopes(['admin:*']), async (req: Request, res: Response) => {
    try {
      const allPartners = await db.select().from(partners);
      return res.json({ ok: true, partners: allPartners });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/admin/api-keys/issue', apiKeyAuth, requireScopes(['admin:*']), async (req, res) => {
    try {
      const body = IssueKey.parse(req.body);
      const notAfter = body.notAfter ? new Date(body.notAfter) : undefined;
      const { token, keyId } = await issueApiKey(body.partnerId, body.scopes as Scope[], notAfter);
      
      return res.json({ ok: true, keyId, token });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/admin/api-keys', apiKeyAuth, requireScopes(['admin:*']), async (req, res) => {
    try {
      const allKeys = await db.select({
        keyId: apiKeys.keyId,
        partnerId: apiKeys.partnerId,
        scopes: apiKeys.scopes,
        status: apiKeys.status,
        notBefore: apiKeys.notBefore,
        notAfter: apiKeys.notAfter,
        ratePerMinute: apiKeys.ratePerMinute,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      }).from(apiKeys);
      
      return res.json({ ok: true, keys: allKeys });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/admin/api-keys/:keyId/revoke', apiKeyAuth, requireScopes(['admin:*']), async (req, res) => {
    try {
      await revokeApiKey(req.params.keyId);
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/admin/api-keys/:keyId/rotate', apiKeyAuth, requireScopes(['admin:*']), async (req, res) => {
    try {
      const { token, keyId } = await rotateApiKey(req.params.keyId);
      return res.json({ ok: true, keyId, token });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  });
}
