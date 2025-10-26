import type { Express, Request, Response } from "express";
import { pool } from "./db.js";
import { z } from "zod";
import crypto from "node:crypto";

const createWebhookSchema = z.object({
  partnerId: z.string().uuid(),
  url: z.string().url(),
  event_types: z.string().min(1), // CSV list: STATUS_UPDATE,TRANSFER,USE,MINT or *
});

const updateWebhookSchema = z.object({
  active: z.boolean().optional(),
  url: z.string().url().optional(),
  event_types: z.string().min(1).optional(),
});

/**
 * Register webhook management routes
 * All routes require admin:* scope
 */
export function registerWebhookRoutes(app: Express) {
  /**
   * Create webhook subscription
   * POST /api/admin/webhooks
   */
  app.post("/api/admin/webhooks", async (req: Request, res: Response) => {
    try {
      const body = createWebhookSchema.parse(req.body);

      // Generate webhook secret (256-bit random hex)
      const secret = crypto.randomBytes(32).toString("hex");

      const result = await pool.query(
        `INSERT INTO webhook_subscriptions 
         (partner_id, url, secret, event_types, active) 
         VALUES ($1, $2, $3, $4, true) 
         RETURNING webhook_id, partner_id, url, event_types, active, created_at`,
        [body.partnerId, body.url, secret, body.event_types]
      );

      const webhook = result.rows[0];

      return res.status(201).json({
        ok: true,
        webhook: {
          ...webhook,
          secret, // Return secret only once at creation
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "validation_error", details: error.errors });
      }
      console.error("[webhooks] Create error:", error.message);
      return res.status(500).json({ error: "internal_server_error" });
    }
  });

  /**
   * List all webhook subscriptions
   * GET /api/admin/webhooks
   */
  app.get("/api/admin/webhooks", async (req: Request, res: Response) => {
    try {
      const partnerId = req.query.partner_id as string | undefined;

      let query = `SELECT webhook_id, partner_id, url, event_types, active, created_at 
                   FROM webhook_subscriptions`;
      const params: any[] = [];

      if (partnerId) {
        query += ` WHERE partner_id = $1`;
        params.push(partnerId);
      }

      query += ` ORDER BY created_at DESC`;

      const result = await pool.query(query, params);

      return res.json({
        ok: true,
        webhooks: result.rows,
      });
    } catch (error: any) {
      console.error("[webhooks] List error:", error.message);
      return res.status(500).json({ error: "internal_server_error" });
    }
  });

  /**
   * Get webhook subscription details
   * GET /api/admin/webhooks/:id
   */
  app.get("/api/admin/webhooks/:id", async (req: Request, res: Response) => {
    try {
      const webhookId = req.params.id;

      const result = await pool.query(
        `SELECT webhook_id, partner_id, url, event_types, active, created_at 
         FROM webhook_subscriptions 
         WHERE webhook_id = $1`,
        [webhookId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "webhook_not_found" });
      }

      return res.json({
        ok: true,
        webhook: result.rows[0],
      });
    } catch (error: any) {
      console.error("[webhooks] Get error:", error.message);
      return res.status(500).json({ error: "internal_server_error" });
    }
  });

  /**
   * Update webhook subscription
   * PATCH /api/admin/webhooks/:id
   */
  app.patch("/api/admin/webhooks/:id", async (req: Request, res: Response) => {
    try {
      const webhookId = req.params.id;
      const body = updateWebhookSchema.parse(req.body);

      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (body.active !== undefined) {
        updates.push(`active = $${paramIndex++}`);
        params.push(body.active);
      }

      if (body.url) {
        updates.push(`url = $${paramIndex++}`);
        params.push(body.url);
      }

      if (body.event_types) {
        updates.push(`event_types = $${paramIndex++}`);
        params.push(body.event_types);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: "no_updates_provided" });
      }

      params.push(webhookId);

      const result = await pool.query(
        `UPDATE webhook_subscriptions 
         SET ${updates.join(", ")} 
         WHERE webhook_id = $${paramIndex} 
         RETURNING webhook_id, partner_id, url, event_types, active, created_at`,
        params
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "webhook_not_found" });
      }

      return res.json({
        ok: true,
        webhook: result.rows[0],
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "validation_error", details: error.errors });
      }
      console.error("[webhooks] Update error:", error.message);
      return res.status(500).json({ error: "internal_server_error" });
    }
  });

  /**
   * Disable webhook subscription
   * POST /api/admin/webhooks/:id/disable
   */
  app.post("/api/admin/webhooks/:id/disable", async (req: Request, res: Response) => {
    try {
      const webhookId = req.params.id;

      const result = await pool.query(
        `UPDATE webhook_subscriptions 
         SET active = false 
         WHERE webhook_id = $1 
         RETURNING webhook_id, partner_id, url, event_types, active, created_at`,
        [webhookId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "webhook_not_found" });
      }

      return res.json({
        ok: true,
        webhook: result.rows[0],
      });
    } catch (error: any) {
      console.error("[webhooks] Disable error:", error.message);
      return res.status(500).json({ error: "internal_server_error" });
    }
  });

  /**
   * Delete webhook subscription
   * DELETE /api/admin/webhooks/:id
   */
  app.delete("/api/admin/webhooks/:id", async (req: Request, res: Response) => {
    try {
      const webhookId = req.params.id;

      const result = await pool.query(
        `DELETE FROM webhook_subscriptions 
         WHERE webhook_id = $1 
         RETURNING webhook_id`,
        [webhookId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "webhook_not_found" });
      }

      return res.json({
        ok: true,
        message: "webhook_deleted",
      });
    } catch (error: any) {
      console.error("[webhooks] Delete error:", error.message);
      return res.status(500).json({ error: "internal_server_error" });
    }
  });

  /**
   * List webhook delivery attempts
   * GET /api/admin/webhooks/:id/deliveries
   */
  app.get("/api/admin/webhooks/:id/deliveries", async (req: Request, res: Response) => {
    try {
      const webhookId = req.params.id;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

      const result = await pool.query(
        `SELECT delivery_id, event_type, status, attempts, last_error, delivered_at
         FROM webhook_deliveries 
         WHERE webhook_id = $1 
         ORDER BY delivered_at DESC NULLS FIRST 
         LIMIT $2`,
        [webhookId, limit]
      );

      return res.json({
        ok: true,
        deliveries: result.rows,
      });
    } catch (error: any) {
      console.error("[webhooks] Deliveries error:", error.message);
      return res.status(500).json({ error: "internal_server_error" });
    }
  });

  /**
   * List failed webhook deliveries across all webhooks
   * GET /api/admin/webhooks/deliveries/failed
   * 
   * Returns recent failed delivery attempts (status not 2xx or delivered_at IS NULL)
   * Useful for monitoring and debugging webhook delivery issues
   */
  app.get("/api/admin/webhooks/deliveries/failed", async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

      const result = await pool.query(
        `SELECT 
          d.delivery_id,
          d.webhook_id,
          d.event_type,
          d.status,
          d.attempts,
          d.last_error,
          d.delivered_at,
          d.created_at,
          w.url,
          w.partner_id
         FROM webhook_deliveries d
         JOIN webhook_subscriptions w ON d.webhook_id = w.webhook_id
         WHERE d.delivered_at IS NULL OR d.status NOT BETWEEN 200 AND 299
         ORDER BY d.created_at DESC 
         LIMIT $1`,
        [limit]
      );

      return res.json({
        ok: true,
        failed_deliveries: result.rows,
        count: result.rows.length,
      });
    } catch (error: any) {
      console.error("[webhooks] Failed deliveries error:", error.message);
      return res.status(500).json({ error: "internal_server_error" });
    }
  });
}
