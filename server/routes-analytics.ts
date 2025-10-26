import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { apiKeyAuth, requireScopes } from "./middleware/apiKey";

export function registerAnalyticsRoutes(app: Express) {
  app.get('/api/admin/analytics/overview', apiKeyAuth, requireScopes(['admin:*']), async (req: Request, res: Response) => {
    try {
      // Query 1: Total proof assets count
      const totalAssetsResult = await pool.query(
        'SELECT COUNT(*) as count FROM proof_assets'
      );
      const totalAssets = parseInt(totalAssetsResult.rows[0].count as string, 10);

      // Query 2: Revoked proofs count
      const revokedResult = await pool.query(
        `SELECT COUNT(*) as count FROM proof_assets WHERE verification_status = 'revoked'`
      );
      const revokedCount = parseInt(revokedResult.rows[0].count as string, 10);

      // Query 3: Total asset usage count
      const usageResult = await pool.query(
        'SELECT COUNT(*) as count FROM asset_usage'
      );
      const totalUses = parseInt(usageResult.rows[0].count as string, 10);

      // Query 4: Last 14 days of proof creation
      const byDayResult = await pool.query(
        `SELECT 
          date_trunc('day', created_at) as day,
          COUNT(*) as count
        FROM proof_assets
        WHERE created_at >= NOW() - INTERVAL '14 days'
        GROUP BY date_trunc('day', created_at)
        ORDER BY day DESC`
      );

      const byDay = byDayResult.rows.map((row: any) => ({
        day: row.day,
        count: parseInt(row.count as string, 10)
      }));

      return res.json({
        ok: true,
        totals: {
          assets: totalAssets,
          revoked: revokedCount,
          uses: totalUses
        },
        byDay
      });
    } catch (e: any) {
      console.error('[analytics] Admin overview error:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });
}

export function registerPartnerRoutes(app: Express) {
  app.get('/api/partner/overview', apiKeyAuth, async (req: Request, res: Response) => {
    try {
      // Get partner_id from query param or auth context
      const partnerId = req.query.partner_id as string || (req as any).partnerId;
      
      if (!partnerId) {
        return res.status(400).json({ 
          ok: false, 
          error: 'partner_id required (from query param or auth context)' 
        });
      }

      // Query 1: Get all proof assets for this partner
      // Note: proof_assets table doesn't have partner_id, so we'll use issuer_did as a proxy
      // In a real implementation, you'd need to add partner_id to proof_assets or use a join
      // For now, we'll query proofs where the issuer matches the partner's DID pattern
      const proofsResult = await pool.query(
        `SELECT proof_asset_id FROM proof_assets WHERE issuer_did LIKE $1`,
        [`%${partnerId}%`]
      );
      
      const proofIds = proofsResult.rows.map((row: any) => row.proof_asset_id);
      const proofCount = proofIds.length;

      // Query 2: Get usage count for partner's proofs
      let usageCount = 0;
      if (proofIds.length > 0) {
        const usageResult = await pool.query(
          `SELECT COUNT(*) as count FROM asset_usage WHERE asset_id = ANY($1)`,
          [proofIds]
        );
        usageCount = parseInt(usageResult.rows[0].count as string, 10);
      }

      // Query 3: Get recent audit events for partner's proofs (LIMIT 10)
      let recentEvents: any[] = [];
      if (proofIds.length > 0) {
        const eventsResult = await pool.query(
          `SELECT 
            event_id,
            event_type,
            asset_id,
            payload,
            trace_id,
            timestamp
          FROM audit_events 
          WHERE asset_id = ANY($1)
          ORDER BY timestamp DESC
          LIMIT 10`,
          [proofIds]
        );
        recentEvents = eventsResult.rows;
      }

      // Query 4: Get API keys for this partner (without secrets)
      const keysResult = await pool.query(
        `SELECT 
          key_id,
          partner_id,
          scopes,
          status,
          not_before,
          not_after,
          rate_per_minute,
          created_at,
          last_used_at
        FROM api_keys
        WHERE partner_id = $1`,
        [partnerId]
      );

      return res.json({
        ok: true,
        proofCount,
        usageCount,
        recentEvents,
        apiKeys: keysResult.rows
      });
    } catch (e: any) {
      console.error('[analytics] Partner overview error:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });
}
