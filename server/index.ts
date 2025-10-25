import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createHash } from "crypto";

const app = express();

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

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
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
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

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

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
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
