import { SignJWT, jwtVerify, createRemoteJWKSet, importJWK, type JWTPayload } from "jose";
import { createHash, randomBytes } from "crypto";

// Algorithm allow-list for receipt signing/verification
const ALLOWED_ALGORITHMS = ["ES256"] as const;
const REQUIRED_HEADER_TYP = "JWT";
const CLOCK_SKEW_SECONDS = 60; // ±60 seconds clock tolerance

// In-memory replay cache (for MVP - use Redis in production)
const replayCache = new Map<string, number>();
const REPLAY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Receipt Claims Interface
 * 
 * A receipt is a signed verification record that binds:
 * - The proof digest (hash of the cryptographic proof)
 * - Policy and constraint hashes
 * - Status list reference for revocation/suspension
 * - Standard JWT claims for expiry, audience, jti (replay protection)
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
  jti: string;                     // JWT ID for replay protection (required)
  aud: string;                     // Expected audience (required)
  exp: number;                     // Expiry timestamp (required)
  nbf: number;                     // Not before timestamp (required)
  nonce?: string;                  // Optional additional replay protection nonce
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
  audience: string;              // Required for strict validation
  subject?: string;              // proof_asset_id
  expiresInSeconds?: number;     // defaults to 1 year
  notBeforeSeconds?: number;     // defaults to now
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
 * Security features:
 * - Generates unique jti for replay protection
 * - Enforces nbf (not before) for time-bound validity
 * - Uses algorithm allow-list (ES256 only)
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
  const notBefore = now - (options.notBeforeSeconds ?? 0); // Allow immediate use by default
  const expiresAt = now + (options.expiresInSeconds ?? 31536000); // Default 1 year
  
  // Generate unique JWT ID for replay protection
  const jti = randomBytes(16).toString('hex');
  
  // Validate algorithm is in allow-list
  const alg = privateKey.alg || "ES256";
  if (!ALLOWED_ALGORITHMS.includes(alg as any)) {
    throw new Error(`Algorithm ${alg} not in allow-list. Only ${ALLOWED_ALGORITHMS.join(', ')} allowed.`);
  }
  
  // Import the private key
  const key = await importJWK(privateKey, alg);
  
  // Build the receipt claims (all required fields)
  const claims: ReceiptClaims = {
    proof_digest: options.proofDigest,
    policy_hash: options.policyHash,
    constraint_hash: options.constraintHash,
    status_ref: options.statusRef,
    jti,
    aud: options.audience,
    iat: now,
    nbf: notBefore,
    exp: expiresAt,
  };
  
  // Add optional claims
  if (options.subject) claims.sub = options.subject;
  if (options.nonce) claims.nonce = options.nonce;
  if (options.issuer) claims.iss = options.issuer;
  
  // Sign as compact JWS with strict header
  const header: any = { 
    alg,
    typ: REQUIRED_HEADER_TYP
  };
  if ((privateKey as any).kid) {
    header.kid = (privateKey as any).kid;
  }
  
  const receipt = await new SignJWT(claims)
    .setProtectedHeader(header)
    .setIssuedAt(now)
    .setNotBefore(notBefore)
    .setExpirationTime(expiresAt)
    .setJti(jti)
    .sign(key);
  
  return receipt;
}

/**
 * Verify a receipt signature and extract claims
 * 
 * This validates:
 * - Algorithm allow-list (only ES256, rejects alg:none)
 * - Header typ field (must be JWT)
 * - Cryptographic signature (using JWKS or direct public key)
 * - Time bounds (nbf, exp with ±60s clock skew)
 * - Audience match (required)
 * - jti replay protection (10-minute cache)
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
    // Decode header without verification to check alg and typ
    const [headerB64] = receipt.split('.');
    if (!headerB64) {
      return { ok: false, reason: "Invalid JWT format" };
    }
    
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
    
    // Validate algorithm allow-list (prevent alg:none attacks)
    if (!header.alg || !ALLOWED_ALGORITHMS.includes(header.alg)) {
      return {
        ok: false,
        reason: `Algorithm ${header.alg || 'none'} not allowed. Only ${ALLOWED_ALGORITHMS.join(', ')} permitted.`,
      };
    }
    
    // Validate typ header
    if (header.typ !== REQUIRED_HEADER_TYP) {
      return {
        ok: false,
        reason: `Invalid header typ: expected ${REQUIRED_HEADER_TYP}, got ${header.typ}`,
      };
    }
    
    // Reject if crit (critical) headers present (we don't support any)
    if (header.crit && Array.isArray(header.crit) && header.crit.length > 0) {
      return {
        ok: false,
        reason: `Unsupported critical header extensions: ${header.crit.join(', ')}`,
      };
    }
    
    let verificationResult;
    const now = options.clockTimestamp || Math.floor(Date.now() / 1000);
    
    // Verify using remote JWKS or direct public key with strict options
    const verifyOptions: any = {
      audience: options.expectedAudience,
      clockTolerance: CLOCK_SKEW_SECONDS,
      currentDate: options.clockTimestamp ? new Date(options.clockTimestamp * 1000) : undefined,
    };
    
    if (options.jwksUrl) {
      const jwks = createRemoteJWKSet(new URL(options.jwksUrl));
      verificationResult = await jwtVerify(receipt, jwks, verifyOptions);
    } else if (options.publicKey) {
      const publicKey = await importJWK(options.publicKey, options.publicKey.alg || "ES256");
      verificationResult = await jwtVerify(receipt, publicKey, verifyOptions);
    } else {
      return {
        ok: false,
        reason: "No verification key provided (need jwksUrl or publicKey)",
      };
    }
    
    const { payload, protectedHeader } = verificationResult;
    
    // Validate required claims presence
    const requiredClaims = ["proof_digest", "policy_hash", "constraint_hash", "status_ref", "jti", "aud", "exp", "nbf"];
    for (const claim of requiredClaims) {
      if (!(claim in payload) || payload[claim] === undefined) {
        return {
          ok: false,
          reason: `missing_or_null_claim_${claim}`,
        };
      }
    }
    
    // Validate audience matches expected (required)
    if (options.expectedAudience && payload.aud !== options.expectedAudience) {
      return {
        ok: false,
        reason: `audience_mismatch: expected ${options.expectedAudience}, got ${payload.aud}`,
      };
    }
    
    // Validate nbf and exp with clock skew
    const nbf = payload.nbf as number;
    const exp = payload.exp as number;
    
    if (now < nbf - CLOCK_SKEW_SECONDS) {
      return {
        ok: false,
        reason: `token_not_yet_valid: nbf=${nbf}, now=${now}`,
      };
    }
    
    if (now > exp + CLOCK_SKEW_SECONDS) {
      return {
        ok: false,
        reason: `token_expired: exp=${exp}, now=${now}`,
      };
    }
    
    // Check jti for replay attacks
    const jti = String(payload.jti);
    if (replayCache.has(jti)) {
      return {
        ok: false,
        reason: `replay_detected: jti=${jti} already used`,
      };
    }
    
    // Add to replay cache with TTL
    replayCache.set(jti, Date.now() + REPLAY_CACHE_TTL_MS);
    cleanupReplayCache(); // Periodic cleanup
    
    // Validate nonce if expected
    if (options.expectedNonce && payload.nonce !== options.expectedNonce) {
      return {
        ok: false,
        reason: "nonce_mismatch",
      };
    }
    
    // Extract and type the claims (all required fields present)
    const claims: ReceiptClaims = {
      proof_digest: String(payload.proof_digest),
      policy_hash: String(payload.policy_hash),
      constraint_hash: String(payload.constraint_hash),
      status_ref: payload.status_ref as ReceiptClaims["status_ref"],
      jti: String(payload.jti),
      aud: String(payload.aud),
      exp: Number(payload.exp),
      nbf: Number(payload.nbf),
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
 * Clean up expired entries from replay cache
 * Called periodically during verification
 */
function cleanupReplayCache(): void {
  const now = Date.now();
  for (const [jti, expiry] of replayCache.entries()) {
    if (now > expiry) {
      replayCache.delete(jti);
    }
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
