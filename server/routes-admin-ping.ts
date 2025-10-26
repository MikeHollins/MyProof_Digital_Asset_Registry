import type { Express, Request, Response } from "express";
import { apiKeyAuth, requireScopes } from "./middleware/apiKey";

export function registerAdminPing(app: Express) {
  // Never expose in production - strict guard
  if (process.env.NODE_ENV === 'production') {
    console.log('[admin-ping] Skipped registration (production mode)');
    return;
  }

  console.log('[admin-ping] Registered admin ping endpoint (development mode only)');
  
  // GET /api/admin/ping -> ok if admin token is valid
  app.get('/api/admin/ping', apiKeyAuth, requireScopes(['admin:*']), async (_req: Request, res: Response) => {
    return res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
  });
}
