import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import { SignJWT, importJWK } from "jose";
import { storage } from "./storage";
import { getReceiptSigningKey } from "./routes";

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
  statusListUrl: "http://localhost:5000/api/demo/status-list", // Local mock endpoint
  statusListIndex: "284109",
  statusPurpose: "revocation" as const,
  issuerDid: "did:example:demo-issuer",
  verifierDid: "did:example:demo-verifier",
  audience: "myproof-registry", // Must match expectedAudience in routes.ts
};

// In-memory status list state (for demo only)
let demoStatusRevoked = false;

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
 * Uses the same receipt signing key that was initialized in routes.ts
 */
function getDemoSigningKey(): JsonWebKey {
  if (process.env.NODE_ENV === 'production') {
    throw new Error("[demo] Receipt signing disabled in production. Use separate verifier service.");
  }
  
  // Try environment variable first
  if (process.env.RECEIPT_VERIFIER_PRIVATE_JWK) {
    return JSON.parse(process.env.RECEIPT_VERIFIER_PRIVATE_JWK);
  }
  
  // Use the ephemeral key generated at startup
  const key = getReceiptSigningKey();
  
  if (!key) {
    throw new Error("[demo] Receipt signing key not initialized. Server may still be starting up.");
  }
  
  return key;
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

      // 3) Generate commitment (deterministic identifier)
      const commitmentData = {
        policy_hash: policyHash,
        constraint_hash: constraintHash,
        proof_id: DEMO.assetId,
        issuer_did: DEMO.issuerDid,
      };
      const commitment = hexDigest(JSON.stringify(commitmentData));

      // 4) Create or update proof asset (idempotent)
      // Note: Don't try to use custom IDs - let DB generate UUID
      let proofAsset;
      try {
        // Try to find existing demo asset by commitment
        const existing = await storage.getProofAssets();
        proofAsset = existing.find(p => p.proofAssetCommitment === commitment);
        
        if (!proofAsset) {
          // Doesn't exist - create new
          proofAsset = await storage.createProofAsset({
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
            assetId: proofAsset.proofAssetId,
            payload: {
              source: "demo_seed",
              issuer_did: DEMO.issuerDid,
              commitment,
            },
            traceId: randomBytes(16).toString('hex'),
          });
        }
      } catch (error) {
        console.error('[demo/seed] Error checking/creating asset:', error);
        throw error;
      }

      // 5) Generate signed receipt (dev-only)
      const jwk = getDemoSigningKey();
      const privateKey = await importJWK(jwk, 'ES256');

      const now = Math.floor(Date.now() / 1000);
      const receiptPayload = {
        proof_digest: proofDigestHex, // Must match database encoding (hex)
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
        jti: `demo-jti-${Date.now()}-${randomBytes(8).toString('hex')}`, // Timestamp + random for uniqueness
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

      // 6) Store the receipt in the proof asset (critical for receipt-based verification)
      await storage.updateProofAsset(proofAsset.proofAssetId, {
        verifierProofRef: receipt,
      });

      // 7) Generate cURL snippets for demo
      const baseUrl = process.env.BASE_URL || "http://localhost:5000";
      
      const curlVerify = `curl -s -X POST ${baseUrl}/api/proof-assets/${proofAsset.proofAssetId}/verify \\
  -H 'Content-Type: application/json' \\
  -d '{"receipt":"${receipt}"}'`;

      const curlRevoke = `curl -s -X POST ${baseUrl}/api/demo/revoke \\
  -H 'Content-Type: application/json' \\
  -d '{}'`;

      // 8) Return demo seed data
      return res.json({
        ok: true,
        demo: {
          assetId: proofAsset.proofAssetId, // Use DB-generated ID
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
      // Generate deterministic commitment to find demo asset
      const policyDoc = { version: "1.0.0", name: "Demo Policy", rules: ["no_pii", "status_check", "hash_only"] };
      const constraintDoc = { version: "1.0.0", name: "Demo Constraint", rules: ["proof_digest_required", "issuer_did_required"] };
      const policyHash = hexDigest(JSON.stringify(policyDoc));
      const constraintHash = hexDigest(JSON.stringify(constraintDoc));
      const commitmentData = {
        policy_hash: policyHash,
        constraint_hash: constraintHash,
        proof_id: DEMO.assetId,
        issuer_did: DEMO.issuerDid,
      };
      const commitment = hexDigest(JSON.stringify(commitmentData));
      
      // Find demo asset by commitment
      const existing = await storage.getProofAssets();
      const proof = existing.find(p => p.proofAssetCommitment === commitment);
      
      if (!proof) {
        return res.status(404).json({
          ok: false,
          error: `Demo asset not found. Run /api/demo/seed first.`
        });
      }

      // Update status to revoked
      const updated = await storage.updateProofAsset(proof.proofAssetId, {
        verificationStatus: "revoked",
      });

      // Flip demo status bit
      demoStatusRevoked = true;

      // Create audit event
      await storage.createAuditEvent({
        eventType: "STATUS_UPDATE",
        assetId: proof.proofAssetId,
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
        assetId: proof.proofAssetId,
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
      // Generate deterministic commitment to find demo asset
      const policyDoc = { version: "1.0.0", name: "Demo Policy", rules: ["no_pii", "status_check", "hash_only"] };
      const constraintDoc = { version: "1.0.0", name: "Demo Constraint", rules: ["proof_digest_required", "issuer_did_required"] };
      const policyHash = hexDigest(JSON.stringify(policyDoc));
      const constraintHash = hexDigest(JSON.stringify(constraintDoc));
      const commitmentData = {
        policy_hash: policyHash,
        constraint_hash: constraintHash,
        proof_id: DEMO.assetId,
        issuer_did: DEMO.issuerDid,
      };
      const commitment = hexDigest(JSON.stringify(commitmentData));
      
      // Find demo asset by commitment
      const existing = await storage.getProofAssets();
      const proof = existing.find(p => p.proofAssetCommitment === commitment);
      
      if (!proof) {
        return res.status(404).json({
          ok: false,
          error: `Demo asset not found. Run /api/demo/seed first.`
        });
      }

      // Reset status to verified
      await storage.updateProofAsset(proof.proofAssetId, {
        verificationStatus: "verified",
        verificationTimestamp: new Date(),
      });

      // Clear demo status bit
      demoStatusRevoked = false;

      // Create audit event
      await storage.createAuditEvent({
        eventType: "STATUS_UPDATE",
        assetId: proof.proofAssetId,
        payload: {
          source: "demo_reset",
          old_status: proof?.verificationStatus || "unknown",
          new_status: "verified",
        },
        traceId: randomBytes(16).toString('hex'),
      });

      return res.json({
        ok: true,
        assetId: proof.proofAssetId,
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

  /**
   * GET /api/demo/status-list
   * 
   * Mock W3C Bitstring Status List endpoint for demo.
   * Returns a compressed bitstring where index 284109 can be revoked/unrevoked.
   */
  app.get("/api/demo/status-list", async (_req: Request, res: Response) => {
    try {
      // Create a bitstring with 131072 bits (16KB compressed)
      const bitstringLength = 131072;
      const byteLength = Math.ceil(bitstringLength / 8);
      const bitstring = Buffer.alloc(byteLength, 0);

      // Set bit 284109 if demo is revoked
      if (demoStatusRevoked) {
        const index = parseInt(DEMO.statusListIndex, 10);
        const byteIndex = Math.floor(index / 8);
        const bitIndex = index % 8;
        bitstring[byteIndex] |= (1 << bitIndex);
      }

      // Compress using gzip
      const zlib = await import('zlib');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        zlib.gzip(bitstring, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      // Return W3C Bitstring Status List format
      return res.json({
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        id: DEMO.statusListUrl,
        type: "BitstringStatusListCredential",
        credentialSubject: {
          id: `${DEMO.statusListUrl}#list`,
          type: "BitstringStatusList",
          encodedList: compressed.toString('base64'),
          statusPurpose: DEMO.statusPurpose,
        },
      });

    } catch (error: any) {
      console.error('[demo/status-list] Error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: error.message 
      });
    }
  });
}
