import type { Request, Response, NextFunction } from "express";
import { validateApiKeyHeader } from "../services/apiKeys";

declare global {
  namespace Express {
    interface Request {
      auth?: { partnerId: string; keyId: string; scopes: string[] }
    }
  }
}

const REDACT_KEYS = ['authorization', 'x-api-key', 'x-partner-key', 'api-key', 'apikey', 'token', 'secret'];

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = (req.headers['x-api-key'] as string) || (req.headers['authorization'] as string);
    const result = await validateApiKeyHeader(header);
    
    if (!result.ok) {
      return res.status(401).json({ error: 'unauthorized', reason: result.reason });
    }

    req.auth = { 
      partnerId: result.partnerId!, 
      keyId: result.keyId!, 
      scopes: result.scopes! 
    };

    for (const k of Object.keys(req.headers)) {
      if (REDACT_KEYS.includes(k.toLowerCase())) {
        req.headers[k] = '<redacted>' as any;
      }
    }

    return next();
  } catch (e: any) {
    return res.status(500).json({ error: 'auth_error', detail: e.message });
  }
}

export function requireScopes(required: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const have = req.auth?.scopes || [];
    const ok = required.every(s => have.includes(s) || have.includes('admin:*'));
    if (!ok) {
      return res.status(403).json({ error: 'forbidden', required });
    }
    return next();
  };
}
