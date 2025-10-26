import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { registerDemoRoutes } from "./routes-demo";
import { setupVite, serveStatic, log } from "./vite";
import helmet from "helmet";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { createHash, randomBytes } from "crypto";
import swaggerUi from "swagger-ui-express";
import { readFileSync } from "fs";
import { join } from "path";

const app = express();

// Disable x-powered-by header for security
app.disable('x-powered-by');

// Trust proxy - Replit runs behind a reverse proxy
app.set('trust proxy', 1);

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Note: 'unsafe-inline' and 'unsafe-eval' required for Vite dev mode
      // In production, use nonce-based CSP with pre-built assets
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "no-referrer" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// Rate limiting for API endpoints (DID-based for privacy-first approach)
// Falls back to IPv6-safe IP bucketing for unauthenticated clients
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each client to 100 requests per windowMs
  message: {
    error: "Too many requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health check
    return req.path === '/health';
  },
  // Privacy-first DID-based rate limiting with IPv6-safe IP fallback
  // Prioritizes stable identifiers (DID, Client-ID) but safely falls back to IP
  keyGenerator: (req) => {
    // First priority: DID from header (most privacy-preserving)
    const did = req.headers['x-did'] as string;
    if (did) return `did:${did}`;
    
    // Second priority: Stable client ID
    const clientId = req.headers['x-client-id'] as string;
    if (clientId) return `client:${clientId}`;
    
    // Fallback: Use library's IPv6-safe IP key generator
    // This is required to prevent IPv6 subnet bypass attacks
    return `ip:${ipKeyGenerator(req as any)}`;
  },
});

// Apply rate limiting to API routes
app.use("/api", apiLimiter);

// Stricter rate limiting for mutations
const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: {
    error: "Too many mutation requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/proof-assets", (req, _res, next) => {
  if (req.method === "POST") {
    return mutationLimiter(req, _res, next);
  }
  next();
});

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

// Body parser with size limits (64KB cap for security)
// Capture raw body for signature verification (needed for JWS/JWT validation)
app.use(express.json({ 
  limit: '64kb',
  verify: (req, res, buf, encoding) => {
    // Store raw buffer for signature verification
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// Request tracing middleware - attach trace_id to every request for log correlation
app.use((req, res, next) => {
  const traceId = crypto.randomUUID();
  (req as any).traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
});

// RFC 7807 Problem Details error handler
function problemDetails(
  res: Response,
  status: number,
  type: string,
  title: string,
  detail?: string,
  instance?: string,
  traceId?: string
) {
  res.status(status).json({
    type: `https://par-registry.example.com/errors/${type}`,
    title,
    status,
    detail,
    instance,
    traceId, // Include trace_id for log correlation
  });
}

// Error handler middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  const traceId = (req as any).traceId;
  console.error(`[error] trace_id=${traceId}`, err.message);
  
  // Check for specific error types
  if (err.name === 'PayloadTooLargeError') {
    return problemDetails(
      res,
      413,
      'payload-too-large',
      'Request payload exceeds size limit',
      'The request body exceeds the 64KB size limit. Please reduce the payload size.',
      req.path,
      traceId
    );
  }
  
  if (err.name === 'SyntaxError' && 'body' in err) {
    return problemDetails(
      res,
      400,
      'invalid-json',
      'Invalid JSON in request body',
      'The request body contains invalid JSON. Please check the syntax.',
      req.path,
      traceId
    );
  }
  
  // Generic error fallback
  problemDetails(
    res,
    500,
    'internal-error',
    'Internal server error',
    process.env.NODE_ENV === 'development' ? err.message : undefined,
    req.path,
    traceId
  );
});

(async () => {
  // Load OpenAPI specification
  const openApiSpec = JSON.parse(
    readFileSync(join(__dirname, "openapi.json"), "utf8")
  );
  
  // Serve OpenAPI spec as JSON
  app.get("/openapi.json", (_req, res) => {
    res.json(openApiSpec);
  });
  
  // Serve Swagger UI documentation
  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "Proof-Asset Registry API",
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
      },
    })
  );
  
  // Register main routes first (initializes receipt keys)
  const server = await registerRoutes(app);
  
  // Register status list routes (database-backed W3C Bitstring Status Lists)
  const { registerStatusListRoutes } = await import("./routes-status-list");
  registerStatusListRoutes(app);
  
  // Register demo routes (requires receipt keys to be initialized)
  await registerDemoRoutes(app);
  
  // Register admin API key management routes
  const { registerAdminApiKeys } = await import("./routes-admin-apikeys");
  registerAdminApiKeys(app);
  
  // Register admin ping route (dev only)
  const { registerAdminPing } = await import("./routes-admin-ping");
  registerAdminPing(app);

  // Register audit export routes (Merkle transparency)
  const { registerAuditExports } = await import("./routes-audit-exports");
  registerAuditExports(app);

  // Register transfer routes (Phase 3: Provenance tracking)
  const { registerTransferRoutes } = await import("./routes-transfer");
  registerTransferRoutes(app);

  // Register usage routes (Phase 3: Usage receipts)
  const { registerUsageRoutes } = await import("./routes-usage");
  registerUsageRoutes(app);

  // Register webhook routes (Partner event notifications)
  const { registerWebhookRoutes } = await import("./routes-webhooks");
  registerWebhookRoutes(app);

  // Register analytics routes (Admin and Partner analytics)
  const { registerAnalyticsRoutes, registerPartnerRoutes } = await import("./routes-analytics");
  registerAnalyticsRoutes(app);
  registerPartnerRoutes(app);

  // Error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  // Setup Vite or static serving
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const PORT = parseInt(process.env.PORT || "5000", 10);
  server.listen(PORT, "0.0.0.0", () => {
    log(`[express] serving on port ${PORT}`);
  });

  // Background cleanup task: Remove expired JTI entries every 5 minutes
  // This prevents unbounded growth of the jti_replay table
  const { cleanupExpiredJti } = await import("./services/jti-repo");
  
  // Run cleanup immediately on startup
  cleanupExpiredJti().catch(err => {
    console.error('[jti-cleanup] Initial cleanup failed:', err);
  });
  
  // Schedule periodic cleanup
  setInterval(async () => {
    try {
      await cleanupExpiredJti();
    } catch (err) {
      console.error('[jti-cleanup] Periodic cleanup failed:', err);
    }
  }, 5 * 60 * 1000); // Every 5 minutes
  
  log('[jti-cleanup] Background JTI cleanup task started (runs every 5 minutes)');
})();
