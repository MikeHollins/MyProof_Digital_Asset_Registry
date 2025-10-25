import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import { SignJWT, importJWK } from "jose";
import { storage } from "./storage";

/**
 * Demo Routes for PAR Registry
 * 
 * Provides end-to-end demonstration of:
 * - Proof asset registration with receipt generation
 * - Receipt-based verification
 * - W3C Status List revocation
 * - Fail-closed re-verification
 * 
 * Security: Receipt signing only allowed in development mode
 */

// Deterministic demo constants (PII-free)
const DEMO = {
  assetId: "DEMO-ASSET-001",
  statusListUrl: "https://status.par-registry.example.com/lists/revocation/demo-001",
  statusListIndex: "284109",
  statusPurpose: "revocation" as const,
  issuerDid: "did:example:demo-issuer",
  verifierDid: "did:example:demo-verifier",
  audience: "par-demo-registry",
};

// Helper: SHA-256 hex digest
function hexDigest(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return createHash('sha256').update(buf).digest('hex');
}

// Helper: SHA-256 base64url digest
function b64uDigest(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return createHash('sha256').update(buf).digest('base64url');
}

/**
 * Get signing key for demo receipt generation
 * Only works in development mode - production should use separate verifier service
 */
async function getDemoSigningKey(): Promise<any> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error("[demo] Receipt signing disabled in production. Use separate verifier service.");
  }
  
  // Load from environment or use the existing receipt service key
  if (process.env.RECEIPT_VERIFIER_PRIVATE_JWK) {
    return JSON.parse(process.env.RECEIPT_VERIFIER_PRIVATE_JWK);
  }
  
  // Generate ephemeral key for demo (will be different each restart)
  const { generateKeyPair, exportJWK } = await import("jose");
  const { privateKey } = await generateKeyPair('ES256');
  const jwk = await exportJWK(privateKey);
  (jwk as any).kid = (jwk as any).kid || randomBytes(8).toString('hex');
  return jwk;
}

export async function registerDemoRoutes(app: Express) {
  
  /**
   * POST /api/demo/seed
   * 
   * Creates a deterministic demo proof asset with signed receipt.
   * Returns receipt + cURL snippets for testing.
   * 
   * Security: Zero PII, deterministic hashes, dev-only signing
   */
  app.post("/api/demo/seed", async (_req: Request, res: Response) => {
    try {
      // 1) Prepare deterministic policy + constraint docs (PII-free)
      const policyDoc = { 
        version: "1.0.0", 
        name: "Demo Policy", 
        rules: ["no_pii", "status_check", "hash_only"] 
      };
      const constraintDoc = { 
        version: "1.0.0", 
        name: "Demo Constraint", 
        rules: ["proof_digest_required", "issuer_did_required"] 
      };

      const policyHash = hexDigest(JSON.stringify(policyDoc));
      const constraintHash = hexDigest(JSON.stringify(constraintDoc));

      // 2) Simulate proof digest (normally hash of actual proof bytes)
      const proofPayload = "DEMO-PROOF-PAYLOAD-NO-PII";
      const proofDigestHex = hexDigest(proofPayload);
      const proofDigestB64u = b64uDigest(proofPayload);

      // 3) Generate commitment (deterministic identifier)
      const commitmentData = {
        policy_hash: policyHash,
        constraint_hash: constraintHash,
        proof_id: DEMO.assetId,
        issuer_did: DEMO.issuerDid,
      };
      const commitment = hexDigest(JSON.stringify(commitmentData));

      // 4) Create or update proof asset (idempotent)
      let proofAsset;
      try {
        proofAsset = await storage.getProofAsset(DEMO.assetId);
        // Already exists - return existing
      } catch (error) {
        // Doesn't exist - create new
        proofAsset = await storage.createProofAsset({
          proofAssetId: DEMO.assetId,
          proofAssetCommitment: commitment,
          issuerDid: DEMO.issuerDid,
          proofFormat: "JWS",
          proofDigest: proofDigestHex,
          digestAlg: "sha2-256",
          constraintHash,
          policyHash,
          policyCid: "bafybeigdemo", // Demo CID
          statusListUrl: DEMO.statusListUrl,
          statusListIndex: DEMO.statusListIndex,
          statusPurpose: DEMO.statusPurpose,
          verificationStatus: "verified",
          verificationTimestamp: new Date(),
        });

        // Create audit event
        await storage.createAuditEvent({
          eventType: "ASSET_CREATED",
          assetId: DEMO.assetId,
          payload: {
            source: "demo_seed",
            issuer_did: DEMO.issuerDid,
            commitment,
          },
          traceId: randomBytes(16).toString('hex'),
        });
      }

      // 5) Generate signed receipt (dev-only)
      const jwk = await getDemoSigningKey();
      const privateKey = await importJWK(jwk, 'ES256');

      const now = Math.floor(Date.now() / 1000);
      const receiptPayload = {
        proof_digest: proofDigestB64u,
        policy_hash: policyHash,
        constraint_hash: constraintHash,
        status_ref: {
          statusListUrl: DEMO.statusListUrl,
          statusListIndex: DEMO.statusListIndex,
          statusPurpose: DEMO.statusPurpose,
        },
        aud: DEMO.audience,
        nbf: now - 30,
        exp: now + (7 * 24 * 3600), // 7 days
        jti: `demo-jti-${randomBytes(16).toString('hex')}`,
        iat: now,
        iss: DEMO.verifierDid,
      };

      const receipt = await new SignJWT(receiptPayload)
        .setProtectedHeader({ 
          alg: 'ES256', 
          typ: 'JWT', 
          kid: (jwk as any).kid || 'demo-key' 
        })
        .sign(privateKey);

      // 6) Generate cURL snippets for demo
      const baseUrl = process.env.BASE_URL || "http://localhost:5000";
      
      const curlVerify = `curl -s -X POST ${baseUrl}/api/proof-assets/${DEMO.assetId}/re-verify \\
  -H 'Content-Type: application/json' \\
  -d '{"receipt":"${receipt}"}'`;

      const curlRevoke = `curl -s -X POST ${baseUrl}/api/demo/revoke \\
  -H 'Content-Type: application/json' \\
  -d '{}'`;

      // 7) Return demo seed data
      return res.json({
        ok: true,
        demo: {
          assetId: DEMO.assetId,
          issuerDid: DEMO.issuerDid,
          verifierDid: DEMO.verifierDid,
          commitment,
          status_ref: {
            url: DEMO.statusListUrl,
            index: DEMO.statusListIndex,
            purpose: DEMO.statusPurpose,
          },
        },
        hashes: {
          policy_hash: policyHash,
          constraint_hash: constraintHash,
          proof_digest_hex: proofDigestHex,
          proof_digest_b64u: proofDigestB64u,
        },
        receipt,
        curls: {
          verify: curlVerify,
          revoke: curlRevoke,
        },
        note: "This is a demo asset with deterministic, PII-free data. Receipt signing only works in development mode.",
      });

    } catch (error: any) {
      console.error('[demo/seed] Error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: error.message,
        hint: error.message.includes('production') 
          ? 'Receipt signing disabled in production - use separate verifier service'
          : undefined
      });
    }
  });

  /**
   * POST /api/demo/revoke
   * 
   * Simulates revoking the demo proof asset.
   * In production, this would update the W3C Status List bitstring.
   * 
   * For demo purposes, we update the proof asset status directly.
   */
  app.post("/api/demo/revoke", async (_req: Request, res: Response) => {
    try {
      // Get demo asset
      const proof = await storage.getProofAsset(DEMO.assetId);
      
      if (!proof) {
        return res.status(404).json({
          ok: false,
          error: `Demo asset ${DEMO.assetId} not found. Run /api/demo/seed first.`
        });
      }

      // Update status to revoked
      const updated = await storage.updateProofAsset(DEMO.assetId, {
        verificationStatus: "revoked",
      });

      // Create audit event
      await storage.createAuditEvent({
        eventType: "STATUS_UPDATE",
        assetId: DEMO.assetId,
        payload: {
          source: "demo_revoke",
          old_status: proof?.verificationStatus || "unknown",
          new_status: "revoked",
          statusListUrl: DEMO.statusListUrl,
          statusListIndex: DEMO.statusListIndex,
        },
        traceId: randomBytes(16).toString('hex'),
      });

      return res.json({
        ok: true,
        assetId: DEMO.assetId,
        statusListUrl: DEMO.statusListUrl,
        statusListIndex: DEMO.statusListIndex,
        operations: [{ op: 'set', index: DEMO.statusListIndex }],
        newStatus: "revoked",
        note: "Demo revocation complete. Re-verification should now fail or return 'revoked' status.",
      });

    } catch (error: any) {
      console.error('[demo/revoke] Error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: error.message 
      });
    }
  });

  /**
   * POST /api/demo/reset
   * 
   * Resets the demo proof asset back to verified status.
   * Useful for running the demo multiple times.
   */
  app.post("/api/demo/reset", async (_req: Request, res: Response) => {
    try {
      // Check if demo asset exists
      let proof;
      try {
        proof = await storage.getProofAsset(DEMO.assetId);
      } catch (error) {
        return res.status(404).json({
          ok: false,
          error: `Demo asset ${DEMO.assetId} not found. Run /api/demo/seed first.`
        });
      }

      // Reset status to verified
      await storage.updateProofAsset(DEMO.assetId, {
        verificationStatus: "verified",
        verificationTimestamp: new Date(),
      });

      // Create audit event
      await storage.createAuditEvent({
        eventType: "STATUS_UPDATE",
        assetId: DEMO.assetId,
        payload: {
          source: "demo_reset",
          old_status: proof?.verificationStatus || "unknown",
          new_status: "verified",
        },
        traceId: randomBytes(16).toString('hex'),
      });

      return res.json({
        ok: true,
        assetId: DEMO.assetId,
        newStatus: "verified",
        note: "Demo asset reset to verified status. You can now run the verification flow again.",
      });

    } catch (error: any) {
      console.error('[demo/reset] Error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: error.message 
      });
    }
  });
}
