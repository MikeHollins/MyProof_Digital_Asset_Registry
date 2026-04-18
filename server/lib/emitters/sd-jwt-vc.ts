// SD-JWT-VC emitter — predicate-only claims mode.
//
// Emits a credential conformant to:
//   draft-ietf-oauth-sd-jwt-vc-15 (Feb 2026)
//   draft-ietf-oauth-selective-disclosure-jwt (RFC 9901, Nov 2025)
//
// Profile choice: every claim we emit is a derived predicate (age_over_21,
// jurisdiction_allowed, etc.) — there is NO raw PII attribute to selectively
// disclose. So the credential is a standard JWS VC with all claims "always
// disclosed" and no `_sd` digests array. This stays SD-JWT-VC-conformant
// because the spec permits an empty or absent disclosure set.
//
// PII invariant: every emitted claim passes through
// `assertClaimsAllowlisted()` before signing (agentsoul.md §26a).

import { SignJWT, importPKCS8, type KeyLike } from "jose";
import { assertClaimsAllowlisted } from "../../../shared/claims-allowlist.js";

export interface SdJwtVcIssueParams {
  /** Issuer DID or HTTPS URL (the "iss" claim). */
  issuer: string;
  /** Subject confirmation — ephemeral per-verification UUID, NOT a user id. */
  sub: string;
  /** Target audience (merchant partner_id or receiving verifier URL). */
  audience: string;
  /** SD-JWT-VC type URI — e.g. "https://schemas.myproof.ai/age-over-21/v1". */
  vct: string;
  /** Predicate claims to include. Every key MUST be on the allowlist. */
  claims: Record<string, string | number | boolean>;
  /** TTL seconds — attestation expires at now + ttl. */
  ttlSeconds: number;
  /** Signer Ed25519 private key in PKCS8 PEM. */
  privateKeyPem: string;
  /** Key ID for the header (fingerprint of pubkey, for verifiers). */
  kid: string;
}

export interface SdJwtVcResult {
  /** Compact SD-JWT string: header.payload.signature (no ~disclosures needed for predicate-only). */
  token: string;
  /** JWT ID (unique per issuance) for replay protection. */
  jti: string;
  /** Numeric issued-at and expiry. */
  iat: number;
  exp: number;
}

// Media type per SD-JWT-VC spec.
export const SD_JWT_VC_MEDIA_TYPE = "application/dc+sd-jwt";

// Verifier discovery: returns the JWT header's typ field so clients can
// content-negotiate on `application/dc+sd-jwt` without parsing the body.
export const SD_JWT_VC_HEADER_TYP = "dc+sd-jwt";

function generateJti(): string {
  // 16 random bytes as hex = 32-char jti. Collisions at O(2^128) events.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function issueSdJwtVc(params: SdJwtVcIssueParams): Promise<SdJwtVcResult> {
  // Claim allowlist enforcement — throws ClaimAllowlistError if any claim
  // name is forbidden or not permitted. This is the predicate-only gate.
  assertClaimsAllowlisted(params.claims);

  const now = Math.floor(Date.now() / 1000);
  const iat = now;
  const exp = now + params.ttlSeconds;
  const jti = generateJti();

  // Import Ed25519 key from PEM.
  const privateKey: KeyLike = await importPKCS8(params.privateKeyPem, "EdDSA");

  // Build the JWS.
  const token = await new SignJWT({
    ...params.claims,
    vct: params.vct,
    jti,
  })
    .setProtectedHeader({
      alg: "EdDSA",
      typ: SD_JWT_VC_HEADER_TYP,
      kid: params.kid,
    })
    .setIssuer(params.issuer)
    .setSubject(params.sub)
    .setAudience(params.audience)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setNotBefore(iat)
    .sign(privateKey);

  // Predicate-only: no ~ disclosures appended. The spec permits this —
  // readers who expect disclosures read the JWS claims directly.
  return { token, jti, iat, exp };
}
