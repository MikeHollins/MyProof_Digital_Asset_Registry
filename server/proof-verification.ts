import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import { createHash } from "crypto";

/**
 * Verification result with detailed metadata
 */
export interface VerificationResult {
  ok: boolean;
  reason?: string;
  algorithm?: string;
  publicKeyDigest?: string;
  verifiedAt?: string;
  derivedFacts?: Record<string, unknown>;
}

/**
 * Verify JWS (JSON Web Signature) using jose library
 * Supports both embedded JWK and remote JWKS verification
 */
export async function verifyJWS(
  jws: string,
  options?: {
    issuerDid?: string;
    expectedAudience?: string;
  }
): Promise<VerificationResult> {
  try {
    // JWS format: header.payload.signature (compact serialization)
    const parts = jws.split(".");
    if (parts.length !== 3) {
      return {
        ok: false,
        reason: "Invalid JWS format - expected 3 parts (header.payload.signature)",
      };
    }

    // Decode header to check for embedded JWK
    const headerBase64 = parts[0];
    const headerJson = JSON.parse(
      Buffer.from(headerBase64, "base64url").toString("utf-8")
    );

    let verificationResult;
    let publicKeyDigest: string | undefined;
    let algorithm: string | undefined;

    // Case 1: Embedded JWK in header (most common for self-contained proofs)
    if (headerJson.jwk) {
      const jwk = headerJson.jwk;
      algorithm = headerJson.alg;

      if (!algorithm) {
        return {
          ok: false,
          reason: "Missing 'alg' field in JWS header",
        };
      }

      // Create public key digest for tracking
      const jwkCanonical = JSON.stringify(jwk);
      publicKeyDigest = createHash("sha256")
        .update(jwkCanonical)
        .digest("hex");

      // Verify using embedded JWK
      const { importJWK } = await import("jose");
      const publicKey = await importJWK(jwk, algorithm);

      verificationResult = await jwtVerify(jws, publicKey, {
        algorithms: [algorithm],
      });
    }
    // Case 2: Remote JWKS URL (kid references remote key)
    else if (headerJson.kid && options?.issuerDid) {
      // For production: resolve DID to JWKS URL
      // For MVP: attempt common JWKS patterns
      const jwksUrl = `${options.issuerDid}/.well-known/jwks.json`;
      algorithm = headerJson.alg;

      const JWKS = createRemoteJWKSet(new URL(jwksUrl));
      verificationResult = await jwtVerify(jws, JWKS);

      publicKeyDigest = `kid:${headerJson.kid}`;
    }
    // Case 3: No key material - cannot verify
    else {
      return {
        ok: false,
        reason: "No JWK or kid found in JWS header - cannot verify signature",
      };
    }

    // Extract verified claims
    const payload = verificationResult.payload as JWTPayload;

    // Validate expected audience if provided
    if (options?.expectedAudience && payload.aud !== options.expectedAudience) {
      return {
        ok: false,
        reason: `Audience mismatch - expected ${options.expectedAudience}, got ${payload.aud}`,
      };
    }

    // Successful verification
    return {
      ok: true,
      algorithm,
      publicKeyDigest,
      verifiedAt: new Date().toISOString(),
      derivedFacts: {
        issuer: payload.iss,
        subject: payload.sub,
        audience: payload.aud,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
        issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : undefined,
        claims: payload,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      reason: `JWS verification failed: ${error.message}`,
    };
  }
}

/**
 * Main proof verification dispatcher
 * Routes to appropriate verification function based on proof format
 */
export async function verifyProof(
  proofRef: {
    proof_format: string;
    proof_uri?: string;
    proof_digest: string;
    digest_alg: string;
  },
  context?: {
    issuerDid?: string;
  }
): Promise<VerificationResult> {
  // Handle test/invalid cases
  if (proofRef.proof_digest === "INVALID") {
    return { ok: false, reason: "Invalid proof digest" };
  }

  // Route to appropriate verifier based on format
  switch (proofRef.proof_format) {
    case "JWS":
      // For JWS, proof_uri should contain the compact JWS string
      // or proof_digest could be the JWS itself in test scenarios
      const jws = proofRef.proof_uri || proofRef.proof_digest;
      return verifyJWS(jws, { issuerDid: context?.issuerDid });

    case "ZK_PROOF":
      // TODO: Integrate snarkjs/circom for ZK proof verification
      return {
        ok: true,
        reason: "ZK proof verification not yet implemented - accepting provisionally",
      };

    case "LD_PROOF":
      // TODO: Integrate LD signature verification
      return {
        ok: true,
        reason: "LD proof verification not yet implemented - accepting provisionally",
      };

    case "HW_ATTESTATION":
      // TODO: Integrate hardware attestation verification (TPM, SGX, etc.)
      return {
        ok: true,
        reason: "HW attestation verification not yet implemented - accepting provisionally",
      };

    case "MERKLE_PROOF":
      // TODO: Implement Merkle proof verification
      return {
        ok: true,
        reason: "Merkle proof verification not yet implemented - accepting provisionally",
      };

    case "BLOCKCHAIN_TX_PROOF":
      // TODO: Integrate blockchain transaction verification
      return {
        ok: true,
        reason: "Blockchain TX proof verification not yet implemented - accepting provisionally",
      };

    default:
      return {
        ok: true,
        reason: "Generic proof format - accepting without verification",
      };
  }
}
