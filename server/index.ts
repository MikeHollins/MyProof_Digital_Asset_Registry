import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createHash } from "crypto";

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
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// Rate limiting for API endpoints (DID-based for privacy-first approach)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each client to 100 requests per windowMs
  message: {
    error: "Too many requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use DID or Client-ID from headers for privacy-first rate limiting
  // Falls back to IP if neither header present
  keyGenerator: (req) => {
    return (req.headers['x-did'] as string) || 
           (req.headers['x-client-id'] as string) || 
           req.ip || 
           'unknown';
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

// Body size caps to prevent DoS attacks
app.use(express.json({
  limit: '64kb',  // Cap JSON request bodies at 64KB
  strict: true,   // Only accept arrays and objects
  type: ['application/json'],
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: false,
  limit: '32kb'  // Cap form bodies at 32KB
}));

// Redact sensitive data from logs (privacy-first logging)
function redactSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  
  const redacted = Array.isArray(obj) ? [...obj] : { ...obj };
  const sensitiveKeys = [
    'verifierProofRef',     // Receipt tokens (JWS)
    'verifier_proof_ref',   // Receipt in requests
    'privateKey',           // Private keys
    'private_key',
    'proof_bytes',          // Proof payloads
    'proofBytes',
    'password',             // Auth credentials
    'token',
    'secret',
    'authorization'
  ];
  
  for (const key in redacted) {
    // Redact sensitive keys
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      redacted[key] = '<redacted>';
    }
    // Recursively redact nested objects
    else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactSensitiveData(redacted[key]);
    }
  }
  
  // Keep only safe fields for proof objects
  if (redacted.proofAssetId || redacted.proof_asset_id) {
    return {
      proofAssetId: redacted.proofAssetId || redacted.proof_asset_id,
      issuerDid: redacted.issuerDid,
      proofFormat: redacted.proofFormat,
      verificationStatus: redacted.verificationStatus,
      proofDigest: redacted.proofDigest?.substring(0, 16) + '...',  // Truncate digests
      policyHash: redacted.policyHash?.substring(0, 16) + '...',
      constraintHash: redacted.constraintHash?.substring(0, 16) + '...',
    };
  }
  
  return redacted;
}

// Response integrity digests and logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    
    // Add response integrity digest (SHA-256 hash of response body)
    // Only set Digest header to preserve helmet's CSP headers
    if (path.startsWith("/api")) {
      const bodyString = JSON.stringify(bodyJson);
      const hash = createHash("sha256").update(bodyString).digest("base64");
      res.setHeader("Digest", `sha-256=${hash}`);
    }
    
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        // Redact sensitive data before logging
        const redacted = redactSensitiveData(capturedJsonResponse);
        logLine += ` :: ${JSON.stringify(redacted)}`;
      }

      if (logLine.length > 200) {
        logLine = logLine.slice(0, 199) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // RFC 7807 Problem Details error handler
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = Number(err.status || err.statusCode || 500);
    const problemDetails = {
      type: err.type || 'about:blank',
      title: err.title || (status >= 500 ? 'Internal Server Error' : 'Request Error'),
      status,
      detail: process.env.NODE_ENV === 'production' ? undefined : (err.message || String(err)),
      instance: req.path,
    };
    
    // Log error for monitoring (with redaction)
    if (status >= 500) {
      console.error('[server-error]', {
        path: req.path,
        method: req.method,
        status,
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      });
    }
    
    res.status(status)
      .type('application/problem+json')
      .json(problemDetails);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
