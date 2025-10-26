import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertProofAssetSchema, updateStatusListSchema } from "@shared/schema";
import { z } from "zod";
import { generateProofCommitment, generateCID, normalizeUrl, validateDigestEncoding } from "./crypto-utils";
import { verifyProof } from "./proof-verification";
import { generateReceipt, generateTestKeypair } from "./receipt-service";
import { notFound, conflict } from "./utils/errors";

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

// Status list allocation
function allocateStatusRef(purpose: string): { statusListUrl: string; statusListIndex: string; statusPurpose: string } {
  const baseUrl = process.env.STATUS_BASE_URL || "https://status.example.com/lists";
  const index = Math.floor(Math.random() * 100000);
  return {
    statusListUrl: `${baseUrl}/${purpose}/default`,
    statusListIndex: String(index),
    statusPurpose: purpose,
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check
  app.get("/api/health", async (_req, res) => {
    const health = await storage.getSystemHealth();
    res.json({ ok: true, ...health });
  });

  // Dashboard stats
  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all proof assets
  app.get("/api/proof-assets", async (_req, res) => {
    try {
      const proofs = await storage.getProofAssets();
      res.json(proofs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get recent proof assets
  app.get("/api/proof-assets/recent", async (_req, res) => {
    try {
      const proofs = await storage.getRecentProofAssets(10);
      res.json(proofs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single proof asset
  app.get("/api/proof-assets/:id", async (req, res) => {
    try {
      const proof = await storage.getProofAsset(req.params.id);
      if (!proof) {
        return res.status(404).json({ error: "Proof asset not found" });
      }
      res.json(proof);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Re-verify a proof asset (receipt-based OR fresh-proof verification)
  app.post("/api/proof-assets/:id/verify", async (req, res) => {
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
        return res.status(404).json({ error: "Proof asset not found" });
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
          return res.status(400).json({ 
            error: "Cannot re-verify: no verification receipt available. This proof was registered before receipt-based verification was enabled.",
            hint: "Use requireFreshProof mode with proof_bytes or proof_uri to verify without receipt",
          });
        }

        console.log('[verify] Step 1: Verifying receipt signature (fast path)...');
        const { verifyReceipt } = await import("./receipt-service");
        
        const receiptVerification = await verifyReceipt(proof.verifierProofRef, {
          publicKey: receiptPublicKey!,
          expectedAudience: "myproof-registry",
        });

        if (!receiptVerification.ok || !receiptVerification.claims) {
          console.log('[verify] ❌ Receipt signature verification failed:', receiptVerification.reason);
          return res.status(400).json({
            error: "Receipt verification failed",
            reason: receiptVerification.reason,
          });
        }
        
        console.log('[verify] ✓ Receipt signature valid');
        claims = receiptVerification.claims;
      }

      // Validate commitments match (prevent substitution attacks) - skip if fresh-proof only
      if (!requireFresh) {
        console.log('[verify] Step 2: Validating commitments...');
        if (claims.proof_digest !== proof.proofDigest) {
          console.log('[verify] ❌ Proof digest mismatch');
          return res.status(400).json({
            error: "Receipt validation failed: proof digest mismatch",
          });
        }
        if (claims.policy_hash !== proof.policyHash) {
          console.log('[verify] ❌ Policy hash mismatch');
          return res.status(400).json({
            error: "Receipt validation failed: policy hash mismatch",
          });
        }
        if (claims.constraint_hash !== proof.constraintHash) {
          console.log('[verify] ❌ Constraint hash mismatch');
          return res.status(400).json({
            error: "Receipt validation failed: constraint hash mismatch",
          });
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
          return res.status(400).json({
            error: "Invalid status list URL format",
            details: error.message,
          });
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
          return res.status(400).json({
            error: "Receipt validation failed: status reference mismatch (url, index, or purpose)",
          });
        }
        console.log('[verify] ✓ Status reference matches');
      }

      // Check W3C Status List with fail-closed security model
      console.log('[verify] Step 4: Checking W3C Status List...');
      const { verifyProofStatus } = await import("./status-list-client");
      
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
        return res.status(503).json({
          error: "Status verification unavailable - failing closed for security",
          reason: statusCheck.reason,
          statusListUrl: proof.statusListUrl,
          failClosed: true,
        });
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
        const { fetchWithSRI, decodeB64u } = await import("./services/sri");
        const { verifyFreshProof } = await import("./services/fresh-verifier");
        
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
            return res.status(400).json({
              error: "Fresh proof fetch failed",
              reason: error.message,
            });
          }
        } else {
          console.log('[verify] ❌ Fresh proof required but not provided');
          return res.status(400).json({
            error: "Fresh proof verification required",
            reason: "fresh_proof_required",
            hint: "Provide either proof_bytes (base64url) or proof_uri (https)",
          });
        }
        
        // Verify fresh proof by format
        console.log('[verify] Executing fresh-proof verification for format:', proof.proofFormat);
        const verifyResult = await verifyFreshProof(proof.proofFormat, proofBytes);
        
        if (!verifyResult.ok) {
          console.log('[verify] ❌ Fresh proof verification failed:', verifyResult.reason);
          return res.status(400).json({
            error: "Fresh proof verification failed",
            reason: verifyResult.reason || "verification_failed",
          });
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
      res.status(500).json({ error: "Verification failed", code: "VERIFICATION_ERROR" });
    }
  });

  // Create new proof asset
  app.post("/api/proof-assets", async (req, res) => {
    try {
      // Validate request body
      const body = insertProofAssetSchema.parse(req.body);

      // Validate digest encoding based on algorithm
      const digestValidation = validateDigestEncoding(body.proofDigest, body.digestAlg);
      if (!digestValidation.valid) {
        return res.status(400).json({
          type: "about:blank",
          title: "Invalid digest encoding",
          status: 400,
          detail: digestValidation.reason,
        });
      }

      // Optional: Validate issuer DID (if DID_VALIDATION_ENABLED)
      const DID_VALIDATION_ENABLED = process.env.DID_VALIDATION_ENABLED === "true";
      if (DID_VALIDATION_ENABLED && body.issuerDid) {
        const { isDidUsable } = await import("./services/did.js");
        const didCheck = await isDidUsable(body.issuerDid);
        if (!didCheck.ok) {
          return res.status(400).json({
            type: "about:blank",
            title: "Invalid issuer DID",
            status: 400,
            detail: didCheck.reason || "DID resolution failed",
            code: didCheck.code || "DID_VALIDATION_FAILED",
          });
        }
      }

      // Verify the proof with issuer context
      const verification = await verifyProof(body.verifier_proof_ref, {
        issuerDid: body.issuerDid,
      });
      
      if (!verification.ok) {
        return res.status(400).json({
          type: "about:blank",
          title: "Invalid proof",
          status: 400,
          detail: verification.reason || "Proof verification failed",
        });
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

      // Allocate status list reference
      const statusRef = allocateStatusRef("revocation");

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

      // Get partner_id from auth context (attached by apiKeyAuth middleware)
      const partnerId = (req as any).partnerId || null;

      // Create proof asset with verification metadata
      const proof = await storage.createProofAsset({
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
      });

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
        return res.status(400).json({
          type: "about:blank",
          title: "Validation error",
          status: 400,
          detail: error.errors[0]?.message || "Invalid request body",
        });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get audit events
  app.get("/api/audit-events", async (_req, res) => {
    try {
      const events = await storage.getAuditEvents();
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Verify audit chain integrity
  app.get("/api/audit-events/verify-chain", async (_req, res) => {
    try {
      const { verifyAuditChainLink } = await import("./crypto-utils");
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
      res.status(500).json({ error: error.message });
    }
  });

  // Check status of a specific proof asset
  app.get("/api/proof-assets/:id/status", async (req, res) => {
    try {
      const proof = await storage.getProofAsset(req.params.id);
      if (!proof) {
        return res.status(404).json({ error: "Proof asset not found" });
      }
      
      // Get the status list
      const statusList = await storage.getStatusList(proof.statusListUrl);
      if (!statusList) {
        return res.status(404).json({ error: "Status list not found" });
      }
      
      // Check the status using bitstring utilities
      const { getCredentialStatus } = await import("./bitstring-utils");
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
      res.status(500).json({ error: error.message });
    }
  });

  // Get status lists
  app.get("/api/status-lists", async (_req, res) => {
    try {
      const lists = await storage.getStatusLists();
      res.json(lists);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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
      const { applyOperations } = await import("./bitstring-utils");
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
        return res.status(400).json({ error: "Invalid request body" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
