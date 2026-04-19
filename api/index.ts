import { app, initApp } from "./_bootstrap.js";
import type { Request, Response } from "express";

export default async function handler(req: Request, res: Response) {
    try {
        // 1. Ensure the Express app memory state is fully initialized per cold-start
        await initApp();

        // 2. Delegate the HTTP request to the initialized Express instance
        return app(req, res);

    } catch (error: any) {
        // 3. ROBUST ERROR HANDLING: Catch anything that crashes the init phase
        console.error("[VERCEL CRITICAL] Failed to bootstrap PAR Express application:");
        console.error(error);

        return res.status(500).json({
            error: "FUNCTION_INVOCATION_FAILED",
            reason: "Express initialization crashed",
            message: error?.message || "Unknown error",
            stack: process.env.NODE_ENV === "development" ? error?.stack : undefined
        });
    }
}
