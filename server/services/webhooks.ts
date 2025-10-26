import crypto from "node:crypto";
import { pool } from "../db.js";

interface Webhook {
  webhook_id: string;
  partner_id: string;
  url: string;
  secret: string;
  event_types: string;
  active: boolean;
}

/**
 * Sign webhook payload with HMAC-SHA256 and timestamp for replay protection
 * @param secret - Webhook secret for signing
 * @param body - JSON string to sign
 * @param ts - Unix timestamp (seconds)
 * @returns Object with signature, base string, and timestamp
 */
function signBody(secret: string, body: string, ts: number) {
  const base = `${ts}.${body}`;
  const sig = crypto.createHmac("sha256", secret).update(base).digest("hex");
  return { base, sig, ts };
}

/**
 * Deliver webhook with retries and exponential backoff
 * Features:
 * - HMAC-SHA256 signature with timestamp
 * - Replay prevention via timestamp header
 * - Exponential backoff: 1s, 5s, 30s, 2m with jitter
 * 
 * @param webhook - Webhook subscription details
 * @param eventType - Event type (STATUS_UPDATE, TRANSFER, USE, MINT, etc.)
 * @param payload - Event payload
 */
export async function deliverWebhook(
  webhook: Webhook,
  eventType: string,
  payload: any
): Promise<void> {
  const ts = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
  const body = JSON.stringify({
    type: eventType,
    data: payload,
    ts: new Date().toISOString(),
  });

  const { sig } = signBody(webhook.secret, body, ts);
  let status = 0;
  let attempts = 0;
  let lastError = "";

  // Retry schedule: 1s, 5s, 30s, 2min with jitter
  const backoffSchedule = [1000, 5000, 30000, 120000];
  const maxAttempts = 4;

  // Retry with exponential backoff
  for (attempts = 1; attempts <= maxAttempts; attempts++) {
    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-MyProof-Signature": sig,
          "X-MyProof-Timestamp": String(ts),
          "X-MyProof-Event": eventType,
        },
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      status = res.status;
      
      if (res.ok) {
        break; // Success, exit retry loop
      }

      lastError = await res.text().catch(() => "http_error");
      
      // Backoff with jitter before next retry
      if (attempts < maxAttempts) {
        const baseDelay = backoffSchedule[attempts - 1] || 120000;
        const jitter = Math.random() * 1000; // 0-1s jitter
        await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
      }
    } catch (e: any) {
      lastError = String(e.message || e);
      
      // Backoff with jitter before retry
      if (attempts < maxAttempts) {
        const baseDelay = backoffSchedule[attempts - 1] || 120000;
        const jitter = Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
      }
    }
  }

  // Record delivery attempt
  await pool.query(
    `INSERT INTO webhook_deliveries 
     (webhook_id, event_type, payload, status, attempts, last_error, delivered_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4 BETWEEN 200 AND 299 THEN now() ELSE NULL END)`,
    [
      webhook.webhook_id,
      eventType,
      JSON.stringify(payload),
      status,
      attempts,
      lastError.substring(0, 500) || null, // Truncate error messages
    ]
  );
}

/**
 * Verify webhook signature (for partners to validate webhooks)
 * Partners should:
 * 1. Recompute HMAC(secret, timestamp + "." + body)
 * 2. Compare to X-MyProof-Signature header
 * 3. Reject if timestamp is older than 5 minutes (replay defense)
 * 
 * @param secret - Webhook secret
 * @param signature - Signature from X-MyProof-Signature header
 * @param timestamp - Timestamp from X-MyProof-Timestamp header
 * @param body - Raw request body
 * @returns true if signature is valid and not replayed
 */
export function verifyWebhookSignature(
  secret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  
  // Reject if timestamp is older than 5 minutes (replay protection)
  if (now - ts > 300) {
    return false;
  }
  
  // Reject if timestamp is in the future (clock skew protection)
  if (ts > now + 60) {
    return false;
  }
  
  // Recompute signature
  const { sig } = signBody(secret, body, ts);
  
  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(sig, 'hex')
  );
}

/**
 * Publish event to all active webhook subscriptions for a partner
 * @param partnerId - Partner UUID
 * @param eventType - Event type (STATUS_UPDATE, TRANSFER, USE, MINT, etc.)
 * @param payload - Event payload
 */
export async function publishEvent(
  partnerId: string,
  eventType: string,
  payload: any
): Promise<void> {
  // Find active webhooks for this partner
  const result = await pool.query(
    `SELECT * FROM webhook_subscriptions 
     WHERE partner_id = $1 AND active = true`,
    [partnerId]
  );

  const webhooks = result.rows as Webhook[];

  // Deliver to matching subscriptions
  for (const webhook of webhooks) {
    const types = webhook.event_types
      .split(",")
      .map((s) => s.trim().toUpperCase());

    if (types.includes(eventType.toUpperCase()) || types.includes("*")) {
      // Fire and forget - don't block on webhook delivery
      deliverWebhook(webhook, eventType, payload).catch((err) => {
        console.error(
          `[webhooks] Delivery failed: webhook=${webhook.webhook_id} event=${eventType} url=${webhook.url.substring(0, 30)}... error=${err.message}`
        );
      });
    }
  }
}

/**
 * Publish event to all active webhook subscriptions (any partner)
 * Used for system-wide events
 */
export async function publishGlobalEvent(
  eventType: string,
  payload: any
): Promise<void> {
  const result = await pool.query(
    `SELECT * FROM webhook_subscriptions WHERE active = true`
  );

  const webhooks = result.rows as Webhook[];

  for (const webhook of webhooks) {
    const types = webhook.event_types
      .split(",")
      .map((s) => s.trim().toUpperCase());

    if (types.includes(eventType.toUpperCase()) || types.includes("*")) {
      deliverWebhook(webhook, eventType, payload).catch((err) => {
        console.error(
          `[webhooks] Delivery failed: webhook=${webhook.webhook_id} event=${eventType} url=${webhook.url.substring(0, 30)}... error=${err.message}`
        );
      });
    }
  }
}
