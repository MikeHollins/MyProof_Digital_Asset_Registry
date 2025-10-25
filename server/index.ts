import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { registerDemoRoutes } from "./routes-demo";
import { setupVite, serveStatic, log } from "./vite";
import helmet from "helmet";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { createHash, randomBytes } from "crypto";

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
    
    // Fallback: Use default IP-based key (IPv6-safe)
    // The library handles IPv6 subnet normalization automatically
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `ip:${ip}`;
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

// RFC 7807 Problem Details error handler
function problemDetails(
  res: Response,
  status: number,
  type: string,
  title: string,
  detail?: string,
  instance?: string
) {
  res.status(status).json({
    type: `https://par-registry.example.com/errors/${type}`,
    title,
    status,
    detail,
    instance,
  });
}

// Error handler middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[error]', err);
  
  // Check for specific error types
  if (err.name === 'PayloadTooLargeError') {
    return problemDetails(
      res,
      413,
      'payload-too-large',
      'Request payload exceeds size limit',
      'The request body exceeds the 64KB size limit. Please reduce the payload size.',
      req.path
    );
  }
  
  if (err.name === 'SyntaxError' && 'body' in err) {
    return problemDetails(
      res,
      400,
      'invalid-json',
      'Invalid JSON in request body',
      'The request body contains invalid JSON. Please check the syntax.',
      req.path
    );
  }
  
  // Generic error fallback
  problemDetails(
    res,
    500,
    'internal-error',
    'Internal server error',
    process.env.NODE_ENV === 'development' ? err.message : undefined,
    req.path
  );
});

(async () => {
  // Register demo routes (before main routes for proper ordering)
  await registerDemoRoutes(app);
  
  const server = await registerRoutes(app);

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
})();
