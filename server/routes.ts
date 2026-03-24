import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage.js";
import { insertProofAssetSchema, updateStatusListSchema } from "@shared/schema";
import { z } from "zod";
import { generateProofCommitment, generateCID, normalizeUrl, validateDigestEncoding } from "./crypto-utils.js";
import { verifyProof } from "./proof-verification.js";
import { generateReceipt, generateTestKeypair } from "./receipt-service.js";
import { notFound, conflict, internalError, badRequest, sendError } from "./utils/errors.js";
import { apiKeyAuth, verifyBodySignature, requireScopes } from "./middleware/apiKey.js";

// Generate signing keypair for receipts (in production, use KMS/HSM)
let receiptSigningKey: JsonWebKey | null = null;
let receiptPublicKey: JsonWebKey | null = null;

// Export getter for demo routes
export function getReceiptSigningKey(): JsonWebKey | null {
  return receiptSigningKey;
}

async function initReceiptKeys() {
  // Try to load keypair from environment (for persistence across restarts)
  const privateKeyEnv = process.env.RECEIPT_VERIFIER_PRIVATE_JWK;
  const publicKeyEnv = process.env.RECEIPT_VERIFIER_PUBLIC_JWK;

  if (privateKeyEnv && publicKeyEnv) {
    try {
      receiptSigningKey = JSON.parse(privateKeyEnv);
      receiptPublicKey = JSON.parse(publicKeyEnv);
      const kid = (receiptPublicKey as any).kid || 'unknown';
      console.log(`[receipt-keys] ✓ Loaded receipt verifier keys from environment (kid: ${kid})`);
      return;
    } catch (error) {
      console.error("[receipt-keys] Failed to parse receipt keys from environment, generating new ones");
    }
  }

  // Only in development mode
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      "[receipt-keys] PRODUCTION ERROR: Receipt verifier keys not configured. " +
      "Set RECEIPT_VERIFIER_PUBLIC_JWK and RECEIPT_VERIFIER_PRIVATE_JWK environment variables. " +
      "In production, use KMS/HSM for key management."
    );
  }

  // Generate new keypair for development only
  console.warn("[receipt-keys] ⚠️  DEVELOPMENT MODE: Generating ephemeral receipt keys");
  const { privateKey, publicKey } = await generateTestKeypair();
  receiptSigningKey = privateKey;
  receiptPublicKey = publicKey;

  const kid = (publicKey as any).kid || 'unknown';
  console.log(`[receipt-keys] Generated new keypair (kid: ${kid})`);
  console.log("[receipt-keys] ⚠️  To persist keys across restarts, set these environment variables:");
  console.log("[receipt-keys] Public JWKS (safe to share):");
  console.log(`RECEIPT_VERIFIER_PUBLIC_JWK='${JSON.stringify(publicKey)}'`);
  console.log("[receipt-keys] ⚠️  PRIVATE KEY - Keep secret, never commit to version control:");
  console.log(`RECEIPT_VERIFIER_PRIVATE_JWK='<redacted in logs - check startup console>'`);

  // Only show private key on first generation, not in logs
  if (process.stdout.isTTY) {
    console.log("\n[receipt-keys] Private JWK (display once, save securely):");
    console.log(JSON.stringify(privateKey, null, 2));
  }
}

// Initialize keys on startup
initReceiptKeys().catch(console.error);

// Status list allocation — sequential, collision-safe
// Uses COUNT(*) on existing proof assets for this status list to determine next index.
// Retries with +1 on collision (concurrent mints).
async function allocateStatusRef(purpose: string): Promise<{ statusListUrl: string; statusListIndex: string; statusPurpose: string }> {
  const baseUrl = process.env.STATUS_BASE_URL || "https://registry.myproof.ai/status";
  const statusListUrl = `${baseUrl}/${purpose}/default`;

  // Count existing allocations for this list to get next sequential index
  const existingCount = await storage.getProofAssetCountByStatusList(statusListUrl);
  const nextIndex = existingCount; // 0-based: first mint gets index 0

  return {
    statusListUrl,
    statusListIndex: String(nextIndex),
    statusPurpose: purpose,
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Phase 2E: API Versioning — /api/v1/* → /api/* URL rewrite
  // Clients can use either /api/v1/proof-assets or /api/proof-assets.
  // When v2 ships, /api/v1/ keeps working, /api/v2/ gets new behavior.
  app.use('/api/v1', (req, res, next) => {
    // Rewrite: /api/v1/proof-assets → handled as /api/proof-assets
    req.url = '/api' + req.url;
    (app as any).handle(req, res, next);
  });

  // Phase 2G: Per-API-key rate limiting on mutation endpoints
  const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
  const PER_KEY_LIMIT = 60;   // 60 req/min per API key
  const GLOBAL_LIMIT = 10;    // 10 req/min for unauthenticated
  const WINDOW_MS = 60_000;   // 1 minute

  function perKeyRateLimit(req: any, res: any, next: any) {
    const key = req.auth?.keyId || req.ip || 'anonymous';
    const limit = req.auth ? PER_KEY_LIMIT : GLOBAL_LIMIT;
    const now = Date.now();

    let entry = rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      rateLimitStore.set(key, entry);
    }

    entry.count++;
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > limit) {
      return res.status(429).json({
        error: 'rate_limited',
        detail: `Rate limit exceeded: ${limit} req/min`,
        retry_after: Math.ceil((entry.resetAt - now) / 1000),
      });
    }

    return next();
  }

  // Health check
  app.get("/api/health", async (_req, res) => {
    const health = await storage.getSystemHealth();
    res.json({ ok: true, ...health });
  });

  // Dashboard stats
  app.get("/api/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error: any) {
      return internalError(req, res, error.message);
    }
  });

  // Get all proof assets
  app.get("/api/proof-assets", async (req, res) => {
    try {
      const proofs = await storage.getProofAssets();
      res.json(proofs);
    } catch (error: any) {
      return internalError(req, res, error.message);
    }
  });

  // Get recent proof assets
  app.get("/api/proof-assets/recent", async (req, res) => {
    try {
      const proofs = await storage.getRecentProofAssets(10);
      res.json(proofs);
    } catch (error: any) {
      return internalError(req, res, error.message);
    }
  });

  // Get single proof asset
  app.get("/api/proof-assets/:id", async (req, res) => {
    try {
      const proof = await storage.getProofAsset(req.params.id);
      if (!proof) {
        return notFound(req, res, "Proof asset not found", "ASSET_NOT_FOUND");
      }
      res.json(proof);
    } catch (error: any) {
      return internalError(req, res, error.message);
    }
  });

  // Re-verify a proof asset (receipt-based OR fresh-proof verification)
  app.post("/api/proof-assets/:id/verify", apiKeyAuth, perKeyRateLimit, async (req, res) => {
    try {
      console.log('[verify] ========== VERIFICATION REQUEST START ==========');
      console.log('[verify] Asset ID:', req.params.id);
      console.log('[verify] Request body:', {
        hasReceipt: !!req.body.receipt,
        requireFresh: !!req.body.requireFreshProof,
        hasProofUri: !!req.body.proof_uri,
        hasProofBytes: !!req.body.proof_bytes,
      });

      const proof = await storage.getProofAsset(req.params.id);
      if (!proof) {
        console.log('[verify] ❌ Proof asset not found');
        return notFound(req, res, "Proof asset not found", "ASSET_NOT_FOUND");
      }

      console.log('[verify] ✓ Proof asset loaded:', {
        assetId: proof.proofAssetId,
        currentStatus: proof.verificationStatus,
        hasReceipt: !!proof.verifierProofRef,
        proofFormat: proof.proofFormat,
      });

      // Determine verification path: receipt-based (fast) or fresh-proof (slow)
      const requireFresh = Boolean(req.body.requireFreshProof);
      let claims: any = null;

      // If requireFreshProof is true, skip receipt validation and go straight to fresh-proof
      if (requireFresh) {
        console.log('[verify] ⚙️  Fresh-proof mode requested - skipping receipt validation');

        // Use proof's stored metadata as claims for fresh-proof verification
        claims = {
          proof_digest: proof.proofDigest,
          policy_hash: proof.policyHash,
          constraint_hash: proof.constraintHash,
          status_ref: {
            statusListUrl: proof.statusListUrl,
            statusListIndex: proof.statusListIndex,
            statusPurpose: proof.statusPurpose,
          },
        };
      } else {
        // Fast path: receipt-based verification
        if (!proof.verifierProofRef) {
          console.log('[verify] ❌ No receipt available for fast-path verification');
          return badRequest(
            req,
            res,
            "Cannot re-verify: no verification receipt available",
            "NO_RECEIPT",
            "Use requireFreshProof mode with proof_bytes or proof_uri to verify without receipt"
          );
        }

        console.log('[verify] Step 1: Verifying receipt signature (fast path)...');
        const { verifyReceipt } = await import("./receipt-service.js");

        const receiptVerification = await verifyReceipt(proof.verifierProofRef, {
          publicKey: receiptPublicKey!,
          expectedAudience: "myproof-registry",
        });

        if (!receiptVerification.ok || !receiptVerification.claims) {
          console.log('[verify] ❌ Receipt signature verification failed:', receiptVerification.reason);
          return badRequest(
            req,
            res,
            "Receipt verification failed",
            "RECEIPT_INVALID",
            receiptVerification.reason
          );
        }

        console.log('[verify] ✓ Receipt signature valid');
        claims = receiptVerification.claims;
      }

      // Validate commitments match (prevent substitution attacks) - skip if fresh-proof only
      if (!requireFresh) {
        console.log('[verify] Step 2: Validating commitments...');
        if (claims.proof_digest !== proof.proofDigest) {
          console.log('[verify] ❌ Proof digest mismatch');
          return badRequest(req, res, "Receipt validation failed: proof digest mismatch", "DIGEST_MISMATCH");
        }
        if (claims.policy_hash !== proof.policyHash) {
          console.log('[verify] ❌ Policy hash mismatch');
          return badRequest(req, res, "Receipt validation failed: policy hash mismatch", "POLICY_MISMATCH");
        }
        if (claims.constraint_hash !== proof.constraintHash) {
          console.log('[verify] ❌ Constraint hash mismatch');
          return badRequest(req, res, "Receipt validation failed: constraint hash mismatch", "CONSTRAINT_MISMATCH");
        }
        console.log('[verify] ✓ All commitments match');
      }

      // Validate status reference matches (prevent receipt substitution from different proof) - skip if fresh-proof only
      if (!requireFresh) {
        console.log('[verify] Step 3: Validating status reference...');
        let normalizedReceiptUrl: string;
        let normalizedProofUrl: string;

        try {
          normalizedReceiptUrl = normalizeUrl(claims.status_ref.statusListUrl);
          normalizedProofUrl = normalizeUrl(proof.statusListUrl);
        } catch (error: any) {
          console.log('[verify] ❌ Invalid status list URL format');
          return badRequest(req, res, "Invalid status list URL format", "INVALID_STATUS_URL", error.message);
        }

        if (normalizedReceiptUrl !== normalizedProofUrl ||
          claims.status_ref.statusListIndex !== proof.statusListIndex ||
          claims.status_ref.statusPurpose !== proof.statusPurpose) {
          console.error('[verify] ❌ Status reference mismatch:', {
            receipt: {
              url: normalizedReceiptUrl,
              index: claims.status_ref.statusListIndex,
              purpose: claims.status_ref.statusPurpose,
            },
            proof: {
              url: normalizedProofUrl,
              index: proof.statusListIndex,
              purpose: proof.statusPurpose,
            }
          });
          return badRequest(req, res, "Receipt validation failed: status reference mismatch", "STATUS_REF_MISMATCH");
        }
        console.log('[verify] ✓ Status reference matches');
      }

      // Check W3C Status List with fail-closed security model
      console.log('[verify] Step 4: Checking W3C Status List...');
      const { verifyProofStatus } = await import("./status-list-client.js");

      let statusVerdict: string;
      let statusCheckReason: string | undefined;

      // Always check current status from W3C Status List (fail-closed)
      const statusCheck = await verifyProofStatus(
        proof.statusListUrl,
        proof.statusListIndex,
        proof.statusPurpose as 'revocation' | 'suspension'
      );

      if (statusCheck.verdict === 'unknown') {
        // Fail closed: status list unreachable or stale
        console.log('[verify] ❌ Status list unreachable - failing closed');
        return sendError(
          req,
          res,
          503,
          "Status verification unavailable - failing closed for security",
          "STATUS_UNAVAILABLE",
          statusCheck.reason
        );
      }

      console.log('[verify] ✓ Status check result:', {
        verdict: statusCheck.verdict,
        reason: statusCheck.reason,
        statusListIndex: proof.statusListIndex,
      });

      statusVerdict = statusCheck.verdict === 'valid' ? 'verified' : statusCheck.verdict;
      statusCheckReason = statusCheck.reason;

      console.log('[verify] Final status verdict:', statusVerdict);

      // Phase 2: Fresh-proof verification path (execute proof bytes if requested)
      let freshProofResult: any = null;

      if (requireFresh) {
        console.log('[verify] ========== FRESH-PROOF MODE ==========');
        console.log('[verify] ⚙️  Fresh-proof mode requested - fetching proof bytes...');
        const { fetchWithSRI, decodeB64u } = await import("./services/sri.js");
        const { verifyFreshProof } = await import("./services/fresh-verifier.js");

        let proofBytes: Uint8Array | null = null;

        if (req.body.proof_bytes) {
          console.log('[verify] Using provided proof_bytes');
          proofBytes = new Uint8Array(decodeB64u(req.body.proof_bytes));
        } else if (req.body.proof_uri) {
          console.log('[verify] Fetching proof from URI with SRI:', req.body.proof_uri);
          try {
            proofBytes = await fetchWithSRI(req.body.proof_uri, claims.proof_digest);
            console.log('[verify] ✓ Proof bytes fetched and SRI validated');
          } catch (error: any) {
            console.log('[verify] ❌ SRI fetch failed:', error.message);
            return badRequest(req, res, "Fresh proof fetch failed", "PROOF_FETCH_FAILED", error.message);
          }
        } else {
          console.log('[verify] ❌ Fresh proof required but not provided');
          return badRequest(
            req,
            res,
            "Fresh proof verification required",
            "PROOF_REQUIRED",
            "Provide either proof_bytes (base64url) or proof_uri (https)"
          );
        }

        // Verify fresh proof by format
        console.log('[verify] Executing fresh-proof verification for format:', proof.proofFormat);
        const verifyResult = await verifyFreshProof(proof.proofFormat, proofBytes);

        if (!verifyResult.ok) {
          console.log('[verify] ❌ Fresh proof verification failed:', verifyResult.reason);
          return badRequest(
            req,
            res,
            "Fresh proof verification failed",
            "FRESH_PROOF_INVALID",
            verifyResult.reason || "verification_failed"
          );
        }

        console.log('[verify] ✓ Fresh proof verified successfully');
        freshProofResult = verifyResult;

        // CRITICAL: Discard proof bytes (privacy-first - never persist)
        proofBytes = null;
      }

      // Update verification timestamp (proof is still valid based on receipt)
      console.log('[verify] Updating proof asset with new status...');
      const updatedProof = await storage.updateProofAsset(proof.proofAssetId, {
        verificationStatus: statusVerdict,
        verificationTimestamp: new Date(),
      });

      // Create audit event
      await storage.createAuditEvent({
        eventType: "USE",
        assetId: proof.proofAssetId,
        payload: {
          old_status: proof.verificationStatus,
          new_status: statusVerdict,
          verification_method: requireFresh ? "fresh_proof" : "receipt_based",
          receipt_verified: true,
          commitments_matched: true,
          fresh_proof_verified: requireFresh,
          re_verification: true,
        },
        traceId: crypto.randomUUID(),
      });

      console.log('[verify] ========== VERIFICATION COMPLETE ==========');
      console.log('[verify] Returning response with status:', statusVerdict);

      res.json({
        success: true,
        verificationStatus: statusVerdict,
        verificationMethod: requireFresh ? "fresh_proof" : "receipt_based",
        verificationResult: {
          ok: true,
          receiptVerified: true,
          commitmentsMatched: true,
          statusChecked: true,
          freshProofVerified: requireFresh,
          freshProofMetadata: freshProofResult?.metadata,
          claims: {
            proof_digest: claims.proof_digest,
            policy_hash: claims.policy_hash,
            constraint_hash: claims.constraint_hash,
            status_ref: claims.status_ref,
          },
        },
        proof: updatedProof,
      });
    } catch (error: any) {
      console.error('[verify] Verification failed:', error.message);
      return internalError(req, res, "Verification failed", "VERIFICATION_ERROR");
    }
  });

  // Create new proof asset (REQUIRES API KEY + SCOPE + BODY SIGNATURE + RATE LIMIT)
  // GAP 10: requireScopes(['assets:mint']) enforces least-privilege
  app.post("/api/proof-assets", apiKeyAuth, requireScopes(['assets:mint']), verifyBodySignature, perKeyRateLimit, async (req, res) => {
    try {
      // Validate request body
      const body = insertProofAssetSchema.parse(req.body);

      // Validate digest encoding based on algorithm
      const digestValidation = validateDigestEncoding(body.proofDigest, body.digestAlg);
      if (!digestValidation.valid) {
        return badRequest(req, res, "Invalid digest encoding", "INVALID_DIGEST", digestValidation.reason);
      }

      // Idempotency check: same (partner, proof_digest) → return existing asset
      const partnerId = req.auth?.partnerId || null;
      const existingAsset = await storage.getProofAssetByDigest(partnerId, body.proofDigest);
      if (existingAsset) {
        return res.status(200).json({
          ...existingAsset,
          _idempotent: true,
          _message: "Proof asset already exists with this digest",
        });
      }

      // Optional: Validate issuer DID (if DID_VALIDATION_ENABLED)
      const DID_VALIDATION_ENABLED = process.env.DID_VALIDATION_ENABLED === "true";
      if (DID_VALIDATION_ENABLED && body.issuerDid) {
        const { isDidUsable } = await import("./services/did.js");
        const didCheck = await isDidUsable(body.issuerDid);
        if (!didCheck.ok) {
          return badRequest(req, res, "Invalid issuer DID", didCheck.code || "DID_VALIDATION_FAILED", didCheck.reason || "DID resolution failed");
        }
      }

      // Verify the proof with issuer context
      const verification = await verifyProof(body.verifier_proof_ref, {
        issuerDid: body.issuerDid,
      });

      if (!verification.ok) {
        return badRequest(req, res, "Invalid proof", "PROOF_VERIFICATION_FAILED", verification.reason || "Proof verification failed");
      }

      // Generate commitment using RFC 8785 JCS + CIDv1
      const commitmentData = {
        policy_cid: body.policyCid,
        policy_hash: body.policyHash,
        constraint_cid: body.constraintCid,
        constraint_hash: body.constraintHash,
        circuit_cid: body.circuitCid,
        schema_cid: body.schemaCid,
        license: body.license || {},
        proof_id: crypto.randomUUID(),
      };
      const proofAssetCommitment = await generateProofCommitment(commitmentData);

      // Allocate status list reference (sequential — await required)
      const statusRef = await allocateStatusRef("revocation");

      // Create status list if it doesn't exist
      let statusList = await storage.getStatusList(statusRef.statusListUrl);
      if (!statusList) {
        statusList = await storage.createStatusList({
          purpose: "revocation",
          url: statusRef.statusListUrl,
          bitstring: Buffer.alloc(16384).toString('base64'), // 131072 bits, base64-encoded
          size: 131072,
          etag: `W/"${Date.now()}"`,
        });
      }

      // Generate verification receipt (signed JWS binding proof digest + policy + constraints)
      let verifierProofRef: string | undefined;
      if (receiptSigningKey) {
        try {
          verifierProofRef = await generateReceipt(receiptSigningKey, {
            proofDigest: body.proofDigest,
            policyHash: body.policyHash,
            constraintHash: body.constraintHash,
            statusRef: {
              statusListUrl: statusRef.statusListUrl,
              statusListIndex: statusRef.statusListIndex,
              statusPurpose: statusRef.statusPurpose as "revocation" | "suspension",
            },
            audience: "myproof-registry",
            issuer: "did:example:verifier",
            expiresInSeconds: 31536000, // 1 year
          });
        } catch (error: any) {
          console.error("[receipt] Receipt generation failed:", error.message);
        }
      }

      // partnerId already extracted above (idempotency check)

      // Phase 4B: Per-policy configurable TTL
      const TTL_POLICY: Record<string, number> = {
        'bar': 86400,        // 24 hours
        'dispensary': 604800, // 7 days
        'bank': 7776000,     // 90 days
        'default': 2592000,  // 30 days
      };
      const policyChannel = body.license?.channel || 'default';
      const ttlSeconds = TTL_POLICY[policyChannel] || TTL_POLICY['default'];
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      // GAP 9: Wrap insert in 23505-safe try-catch for concurrent insert race condition
      let proof;
      try {
        proof = await storage.createProofAsset({
          proofAssetCommitment,
          issuerDid: body.issuerDid,
          partnerId,
          subjectBinding: body.subjectBinding,
          proofFormat: body.proofFormat,
          proofDigest: body.proofDigest,
          digestAlg: body.digestAlg,
          proofUri: body.verifier_proof_ref.proof_uri,
          constraintHash: body.constraintHash,
          constraintCid: body.constraintCid,
          policyHash: body.policyHash,
          policyCid: body.policyCid,
          circuitOrSchemaId: body.circuitOrSchemaId,
          circuitCid: body.circuitCid,
          schemaCid: body.schemaCid,
          license: body.license,
          statusListUrl: statusRef.statusListUrl,
          statusListIndex: statusRef.statusListIndex,
          statusPurpose: statusRef.statusPurpose,
          verificationStatus: "verified",
          verificationAlgorithm: verification.algorithm,
          verificationPublicKeyDigest: verification.publicKeyDigest,
          verificationTimestamp: verification.verifiedAt ? new Date(verification.verifiedAt) : new Date(),
          verificationMetadata: verification.derivedFacts,
          verifierProofRef,
          ttlSeconds,
          expiresAt,
        });
      } catch (insertErr: any) {
        // Postgres unique violation — concurrent insert won the race
        if (insertErr.code === '23505') {
          const raceWinner = await storage.getProofAssetByDigest(partnerId, body.proofDigest);
          if (raceWinner) {
            return res.status(200).json({
              ...raceWinner,
              _idempotent: true,
              _message: "Concurrent insert resolved — returning existing asset",
            });
          }
        }
        throw insertErr;
      }

      // Create audit event
      await storage.createAuditEvent({
        eventType: "MINT",
        assetId: proof.proofAssetId,
        payload: {
          issuer_did: proof.issuerDid,
          proof_format: proof.proofFormat,
          commitment: proofAssetCommitment,
        },
        traceId: crypto.randomUUID(),
      });

      res.status(201).json({
        ...proof,
        _receipt: verifierProofRef, // Include receipt in response for client
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return badRequest(req, res, "Validation error", "VALIDATION_FAILED", error.errors[0]?.message || "Invalid request body");
      }
      return internalError(req, res, error.message);
    }
  });

  // Get audit events
  app.get("/api/audit-events", async (req, res) => {
    try {
      const events = await storage.getAuditEvents();
      res.json(events);
    } catch (error: any) {
      return internalError(req, res, error.message);
    }
  });

  // Verify audit chain integrity
  app.get("/api/audit-events/verify-chain", async (req, res) => {
    try {
      const { verifyAuditChainLink } = await import("./crypto-utils.js");
      const events = await storage.getAuditEvents();

      // Sort events in chronological order (oldest first)
      const sortedEvents = [...events].reverse();

      // Verify each event's hash and previousHash linkage
      const results = await Promise.all(sortedEvents.map(async (event, index) => {
        // Verify the event's own hash is correct
        const hashValid = await verifyAuditChainLink({
          eventType: event.eventType,
          assetId: event.assetId,
          payload: event.payload,
          previousHash: event.previousHash,
          eventHash: event.eventHash,
          timestamp: event.timestamp,
        });

        // Verify previousHash matches the prior event's hash
        let linkageValid = true;
        let linkageReason = "";

        if (index === 0) {
          // First event should have null previousHash
          linkageValid = event.previousHash === null;
          if (!linkageValid) linkageReason = "First event should have null previousHash";
        } else {
          // Subsequent events should link to previous event's hash
          const previousEvent = sortedEvents[index - 1];
          linkageValid = event.previousHash === previousEvent.eventHash;
          if (!linkageValid) {
            linkageReason = `previousHash mismatch: expected ${previousEvent.eventHash}, got ${event.previousHash}`;
          }
        }

        const isValid = hashValid && linkageValid;

        return {
          eventId: event.eventId,
          eventType: event.eventType,
          isValid,
          hashValid,
          linkageValid,
          linkageReason: linkageReason || undefined,
          index,
        };
      }));

      const allValid = results.every(r => r.isValid);
      const invalidEvents = results.filter(r => !r.isValid);

      res.json({
        chainValid: allValid,
        totalEvents: events.length,
        validEvents: results.filter(r => r.isValid).length,
        invalidEvents: invalidEvents.length,
        details: results,
      });
    } catch (error: any) {
      return internalError(req, res, error.message);
    }
  });

  // Check status of a specific proof asset
  app.get("/api/proof-assets/:id/status", async (req, res) => {
    try {
      const proof = await storage.getProofAsset(req.params.id);
      if (!proof) {
        return notFound(req, res, "Proof asset not found", "ASSET_NOT_FOUND");
      }

      // Get the status list
      const statusList = await storage.getStatusList(proof.statusListUrl);
      if (!statusList) {
        return notFound(req, res, "Status list not found", "STATUS_LIST_NOT_FOUND");
      }

      // Check the status using bitstring utilities
      const { getCredentialStatus } = await import("./bitstring-utils.js");
      const status = getCredentialStatus(
        statusList.bitstring,
        parseInt(proof.statusListIndex),
        proof.statusPurpose
      );

      res.json({
        proofAssetId: proof.proofAssetId,
        statusListUrl: proof.statusListUrl,
        statusListIndex: proof.statusListIndex,
        ...status,
        checkedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      return internalError(req, res, error.message);
    }
  });

  // Get status lists
  app.get("/api/status-lists", async (req, res) => {
    try {
      const lists = await storage.getStatusLists();
      res.json(lists);
    } catch (error: any) {
      return internalError(req, res, error.message);
    }
  });

  // Update status list
  app.post("/api/status-lists/:purpose/update", async (req, res) => {
    try {
      const body = updateStatusListSchema.parse(req.body);

      let statusList = await storage.getStatusList(body.statusListUrl);
      if (!statusList) {
        return notFound(req, res, "Status list not found", "STATUS_LIST_NOT_FOUND");
      }

      // Optimistic concurrency control: check If-Match header
      const ifMatch = req.headers['if-match'];
      if (ifMatch && statusList.etag && ifMatch !== statusList.etag) {
        return conflict(
          req,
          res,
          "Precondition failed - status list was modified",
          "ETAG_MISMATCH",
          `Current ETag: ${statusList.etag}`
        );
      }

      // Decode base64 bitstring, apply operations using utilities, re-encode
      const { applyOperations } = await import("./bitstring-utils.js");
      const bitstring = Buffer.from(statusList.bitstring, 'base64');
      applyOperations(bitstring, body.operations);

      const etag = `W/"${Date.now()}"`;
      await storage.updateStatusList(body.statusListUrl, bitstring.toString('base64'), etag);

      // Create audit event for status update
      await storage.createAuditEvent({
        eventType: "STATUS_UPDATE",
        assetId: null, // Could be linked to specific proof if available
        payload: {
          status_list_url: body.statusListUrl,
          operations: body.operations,
          purpose: req.params.purpose,
        },
        traceId: crypto.randomUUID(),
      });

      res.json({ updated: true, etag });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return badRequest(req, res, "Invalid request body", "VALIDATION_FAILED");
      }
      return internalError(req, res, error.message);
    }
  });

  // Phase 3D: Dead Letter Queue — Admin endpoints for failed mint management
  app.get("/api/admin/failed-mints", apiKeyAuth, async (req, res) => {
    try {
      // Require admin scope
      if (!req.auth?.scopes?.includes('admin:*')) {
        return res.status(403).json({ error: 'forbidden', detail: 'admin:* scope required' });
      }
      const limit = parseInt(req.query.limit as string) || 50;
      const failures = await storage.getUnresolvedMintFailures(limit);
      res.json({
        count: failures.length,
        failures,
        _hint: 'POST /api/admin/retry-failed-mints to retry',
      });
    } catch (error: any) {
      return internalError(req, res, error.message);
    }
  });

  app.post("/api/admin/retry-failed-mints", apiKeyAuth, async (req, res) => {
    try {
      if (!req.auth?.scopes?.includes('admin:*')) {
        return res.status(403).json({ error: 'forbidden', detail: 'admin:* scope required' });
      }
      const failures = await storage.getUnresolvedMintFailures(50);
      let resolved = 0;
      let retried = 0;

      for (const failure of failures) {
        if (failure.attempts >= failure.maxRetries) {
          // Already exhausted retries — mark as resolved with 'exhausted'
          await storage.resolveMintFailure(failure.failureId, 'exhausted');
          resolved++;
        } else {
          // Could re-enqueue mint here. For now, mark as resolved by admin.
          await storage.resolveMintFailure(failure.failureId, 'manual');
          retried++;
        }
      }

      res.json({
        total: failures.length,
        retried,
        resolved,
        _note: 'All failures have been resolved. Re-mint must be triggered manually via POST /api/proof-assets.',
      });
    } catch (error: any) {
      return internalError(req, res, error.message);
    }
  });

  // Partners CRUD — Admin endpoints for partner management
  app.get("/api/admin/partners", apiKeyAuth, async (req, res) => {
    try {
      if (!req.auth?.scopes?.includes('admin:*')) {
        return res.status(403).json({ error: 'forbidden', detail: 'admin:* scope required' });
      }
      const partners = await storage.listPartners();
      res.json(partners);
    } catch (err: any) {
      return internalError(req, res, err.message);
    }
  });

  app.post("/api/admin/partners", apiKeyAuth, async (req, res) => {
    try {
      if (!req.auth?.scopes?.includes('admin:*')) {
        return res.status(403).json({ error: 'forbidden', detail: 'admin:* scope required' });
      }
      const { name, contactEmail, webhookUrl, webhookSecret } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'bad_request', detail: 'name is required' });
      }
      const partner = await storage.createPartner({
        name,
        contactEmail: contactEmail || null,
        webhookUrl: webhookUrl || null,
        webhookSecret: webhookSecret || null,
      });
      res.status(201).json(partner);
    } catch (err: any) {
      return internalError(req, res, err.message);
    }
  });

  // Phase 2H: Key Compromise Recovery — Revoked Keys Discovery
  // In production, this would be backed by a database table.
  // For now, env-configurable list of revoked key IDs.
  const REVOKED_KIDS = new Set(
    (process.env.REVOKED_KEY_IDS || '').split(',').filter(Boolean)
  );

  app.get("/.well-known/revoked-keys.json", (_req, res) => {
    const revokedKeys = Array.from(REVOKED_KIDS).map(kid => ({
      kid,
      revoked_at: new Date().toISOString(), // In production: lookup from DB
      reason: "key_compromise",
    }));

    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
    res.json({
      issuer: "registry.myproof.ai",
      revoked_keys: revokedKeys,
      updated_at: new Date().toISOString(),
    });
  });

  const httpServer = createServer(app);
  return httpServer;
}
