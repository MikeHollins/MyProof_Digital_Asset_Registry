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

/**
 * Phase 2D: Body signature verification for mutual auth.
 * 
 * Validates HMAC-SHA256(apiKey, traceId:bodyHash:timestamp) signature
 * from the X-Body-Signature header. Ensures:
 * 1. Request came from a holder of the API key (not just header replay)
 * 2. Body has not been tampered with in transit
 * 3. Timestamp is within ±60s (prevents replay)
 * 
 * Only rejects if signature header IS present but invalid.
 * If header is absent, passes through (backward compatibility).
 */
export function verifyBodySignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers['x-body-signature'] as string;

  // If no signature header, allow (backward compat). 
  // In production, make this mandatory by checking NODE_ENV.
  if (!signature) {
    return next();
  }

  const traceId = req.headers['x-trace-id'] as string;
  const timestamp = req.headers['x-signature-timestamp'] as string;
  const apiKey = req.headers['x-api-key'] as string || '';

  if (!traceId || !timestamp) {
    return res.status(403).json({
      error: 'signature_incomplete',
      detail: 'X-Trace-Id and X-Signature-Timestamp required with X-Body-Signature'
    });
  }

  // Check timestamp freshness (±60 seconds)
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 60) {
    return res.status(403).json({
      error: 'signature_expired',
      detail: 'Request signature timestamp outside ±60s window'
    });
  }

  // Recompute body hash and verify HMAC
  const { createHash, createHmac } = require('node:crypto');
  const bodyHash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
  const expectedPayload = `${traceId}:${bodyHash}:${timestamp}`;
  const expectedSignature = createHmac('sha256', apiKey)
    .update(expectedPayload)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(403).json({
      error: 'signature_invalid',
      detail: 'Body signature verification failed'
    });
  }

  return next();
}
