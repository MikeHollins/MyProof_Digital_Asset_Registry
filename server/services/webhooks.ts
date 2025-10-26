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
 * Sign webhook payload with HMAC-SHA256
 * @param secret - Webhook secret for signing
 * @param body - JSON string to sign
 * @returns HMAC-SHA256 signature (hex)
 */
function signBody(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/**
 * Deliver webhook with retries and exponential backoff
 * @param webhook - Webhook subscription details
 * @param eventType - Event type (STATUS_UPDATE, TRANSFER, USE, MINT, etc.)
 * @param payload - Event payload
 */
export async function deliverWebhook(
  webhook: Webhook,
  eventType: string,
  payload: any
): Promise<void> {
  const body = JSON.stringify({
    type: eventType,
    data: payload,
    ts: new Date().toISOString(),
  });

  const sig = signBody(webhook.secret, body);
  let status = 0;
  let attempts = 0;
  let lastError = "";

  // Retry up to 3 times with exponential backoff
  for (attempts = 1; attempts <= 3; attempts++) {
    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-MyProof-Signature": sig,
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
      
      // Backoff: 1s, 2s, 3s
      if (attempts < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempts * 1000));
      }
    } catch (e: any) {
      lastError = String(e.message || e);
      
      // Backoff before retry
      if (attempts < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempts * 1000));
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
      lastError || null,
    ]
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
          `[webhooks] Delivery failed: webhook=${webhook.webhook_id} event=${eventType} url=${webhook.url.substring(0, 30)}...`
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
          `[webhooks] Delivery failed: webhook=${webhook.webhook_id} event=${eventType} url=${webhook.url.substring(0, 30)}...`
        );
      });
    }
  }
}
