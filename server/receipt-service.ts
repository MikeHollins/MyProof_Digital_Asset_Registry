import { SignJWT, jwtVerify, createRemoteJWKSet, importJWK, type JWTPayload } from "jose";
import { createHash } from "crypto";

/**
 * Receipt Claims Interface
 * 
 * A receipt is a signed verification record that binds:
 * - The proof digest (hash of the cryptographic proof)
 * - Policy and constraint hashes
 * - Status list reference for revocation/suspension
 * - Standard JWT claims for expiry, audience, nonce
 * 
 * This allows re-verification WITHOUT storing the original proof bytes (privacy-first).
 */
export interface ReceiptClaims extends JWTPayload {
  proof_digest: string;           // SHA-256 digest of original proof (base64url)
  policy_hash: string;             // Policy CID or hash
  constraint_hash: string;         // Constraint CID or hash
  status_ref: {                    // W3C Status List reference
    statusListUrl: string;
    statusListIndex: string;
    statusPurpose: "revocation" | "suspension";
  };
  aud?: string;                    // Expected audience (e.g., "myproof-registry")
  exp?: number;                    // Expiry timestamp (seconds since epoch)
  nbf?: number;                    // Not before timestamp
  nonce?: string;                  // Replay protection nonce
  iss?: string;                    // Issuer (verifier DID)
  sub?: string;                    // Subject (proof asset ID)
}

export interface GenerateReceiptOptions {
  proofDigest: string;
  policyHash: string;
  constraintHash: string;
  statusRef: {
    statusListUrl: string;
    statusListIndex: string;
    statusPurpose: "revocation" | "suspension";
  };
  audience?: string;
  subject?: string;              // proof_asset_id
  expiresInSeconds?: number;     // defaults to 1 year
  nonce?: string;
  issuer?: string;               // verifier DID
}

export interface VerifyReceiptOptions {
  jwksUrl?: string;              // Remote JWKS URL for verification
  publicKey?: JsonWebKey;        // Or provide direct public key
  expectedAudience?: string;
  expectedNonce?: string;
  clockTimestamp?: number;       // Optional timestamp for testing
}

export interface ReceiptVerificationResult {
  ok: boolean;
  reason?: string;
  claims?: ReceiptClaims;
  headerKid?: string;
  headerAlg?: string;
}

/**
 * Generate a signed verification receipt (compact JWS)
 * 
 * This creates a cryptographic proof that verification occurred with specific parameters.
 * The receipt can be verified later without needing the original proof bytes.
 * 
 * @param privateKey - JWK private key for signing (ES256 recommended)
 * @param options - Receipt claims and metadata
 * @returns Compact JWS string (header.payload.signature)
 */
export async function generateReceipt(
  privateKey: JsonWebKey,
  options: GenerateReceiptOptions
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (options.expiresInSeconds ?? 31536000); // Default 1 year
  
  // Import the private key
  const key = await importJWK(privateKey, privateKey.alg || "ES256");
  
  // Build the receipt claims
  const claims: ReceiptClaims = {
    proof_digest: options.proofDigest,
    policy_hash: options.policyHash,
    constraint_hash: options.constraintHash,
    status_ref: options.statusRef,
    iat: now,
    exp: expiresAt,
  };
  
  // Add optional claims
  if (options.audience) claims.aud = options.audience;
  if (options.subject) claims.sub = options.subject;
  if (options.nonce) claims.nonce = options.nonce;
  if (options.issuer) claims.iss = options.issuer;
  
  // Sign as compact JWS
  const header: any = { 
    alg: privateKey.alg || "ES256",
    typ: "JWT"
  };
  if ((privateKey as any).kid) {
    header.kid = (privateKey as any).kid;
  }
  
  const receipt = await new SignJWT(claims)
    .setProtectedHeader(header)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(key);
  
  return receipt;
}

/**
 * Verify a receipt signature and extract claims
 * 
 * This validates:
 * - Cryptographic signature (using JWKS or direct public key)
 * - Expiry window (nbf, exp)
 * - Audience match (if expected)
 * - Nonce match (if expected)
 * - Presence of required claims
 * 
 * @param receipt - Compact JWS string
 * @param options - Verification parameters
 * @returns Verification result with claims if valid
 */
export async function verifyReceipt(
  receipt: string,
  options: VerifyReceiptOptions
): Promise<ReceiptVerificationResult> {
  try {
    let verificationResult;
    
    // Verify using remote JWKS or direct public key
    if (options.jwksUrl) {
      const jwks = createRemoteJWKSet(new URL(options.jwksUrl));
      verificationResult = await jwtVerify(receipt, jwks, {
        audience: options.expectedAudience,
      });
    } else if (options.publicKey) {
      const publicKey = await importJWK(options.publicKey, options.publicKey.alg || "ES256");
      verificationResult = await jwtVerify(receipt, publicKey, {
        audience: options.expectedAudience,
      });
    } else {
      return {
        ok: false,
        reason: "No verification key provided (need jwksUrl or publicKey)",
      };
    }
    
    const { payload, protectedHeader } = verificationResult;
    
    // Validate nonce if expected
    if (options.expectedNonce && payload.nonce !== options.expectedNonce) {
      return {
        ok: false,
        reason: "nonce_mismatch",
      };
    }
    
    // Validate required receipt claims
    const requiredClaims = ["proof_digest", "policy_hash", "constraint_hash", "status_ref"];
    for (const claim of requiredClaims) {
      if (!(claim in payload)) {
        return {
          ok: false,
          reason: `missing_claim_${claim}`,
        };
      }
    }
    
    // Extract and type the claims
    const claims: ReceiptClaims = {
      proof_digest: String(payload.proof_digest),
      policy_hash: String(payload.policy_hash),
      constraint_hash: String(payload.constraint_hash),
      status_ref: payload.status_ref as ReceiptClaims["status_ref"],
      aud: payload.aud as string | undefined,
      exp: payload.exp as number | undefined,
      nbf: payload.nbf as number | undefined,
      iat: payload.iat as number | undefined,
      nonce: payload.nonce as string | undefined,
      iss: payload.iss as string | undefined,
      sub: payload.sub as string | undefined,
    };
    
    return {
      ok: true,
      claims,
      headerKid: protectedHeader.kid,
      headerAlg: protectedHeader.alg,
    };
  } catch (error: any) {
    return {
      ok: false,
      reason: `Receipt verification failed: ${error.message}`,
    };
  }
}

/**
 * Generate a test keypair for receipt signing (development/testing only)
 * 
 * In production, use a proper KMS or HSM for key management.
 * 
 * @returns Promise<{privateKey: JsonWebKey, publicKey: JsonWebKey}>
 */
export async function generateTestKeypair(): Promise<{
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
}> {
  const { generateKeyPair, exportJWK } = await import("jose");
  
  const { privateKey: privKey, publicKey: pubKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  
  const privateKey = await exportJWK(privKey);
  const publicKey = await exportJWK(pubKey);
  
  // Add kid (key ID) for tracking
  const kid = createHash("sha256")
    .update(JSON.stringify(publicKey))
    .digest("hex")
    .substring(0, 16);
  
  (privateKey as any).kid = kid;
  (publicKey as any).kid = kid;
  privateKey.alg = "ES256";
  publicKey.alg = "ES256";
  
  return { privateKey, publicKey };
}
