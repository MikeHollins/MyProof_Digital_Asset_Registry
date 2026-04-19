import { cleanupExpiredJti } from "./_bootstrap.js";
import type { Request, Response } from "express";

/**
 * Vercel Cron Job endpoint for JTI cleanup.
 * Replaces the setInterval-based cleanup that runs in long-running process mode.
 *
 * Configured in vercel.json: runs every 5 minutes.
 * Only accepts requests from Vercel's cron scheduler (User-Agent: vercel-cron/1.0).
 */
export default async function handler(req: Request, res: Response) {
    // Verify this is a cron invocation (Vercel sets this user-agent)
    const userAgent = req.headers["user-agent"] || "";
    if (!userAgent.includes("vercel-cron")) {
        return res.status(401).json({ error: "Unauthorized: cron-only endpoint" });
    }

    try {
        await cleanupExpiredJti();

        return res.status(200).json({
            ok: true,
            message: "JTI cleanup completed",
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("[cron] JTI cleanup failed:", error);
        return res.status(500).json({
            ok: false,
            error: error?.message || "Cleanup failed",
        });
    }
}
