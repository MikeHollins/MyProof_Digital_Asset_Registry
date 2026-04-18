// PERMITTED_CREDENTIAL_CLAIMS — allowlist for outbound credential emission.
//
// Enforces the PII invariant: every SD-JWT-VC claim, every ISO mdoc element, and
// every OpenID4VP presentation we emit MUST use a claim name on this allowlist.
// Raw identity attributes (birth_date, family_name, passport_number, portrait, etc.)
// are explicitly excluded.
//
// This is the outbound counterpart to the inbound zod ProofEnvelope fence.
// Consumed by Phase 4 emitters (sd-jwt-vc.ts, mdoc.ts, openid4vp/verifier.ts).
//
// Governance: adding a claim requires (a) confirming it is a derived predicate
// or public metadata, (b) PR checklist justification against the PII invariant
// in agentsoul.md §26a, (c) review by security-reviewer agent.

// Exact claim names permitted in outbound credentials.
export const PERMITTED_CLAIM_NAMES: ReadonlySet<string> = new Set([
  // Age predicates — most common. Merchant gets a boolean, never the DOB.
  "age_over_13",
  "age_over_14",
  "age_over_15",
  "age_over_16",
  "age_over_17",
  "age_over_18",
  "age_over_19",
  "age_over_20",
  "age_over_21",
  "age_over_25",
  "age_over_65",

  // Document status predicates.
  "document_valid",       // All policy rules passed
  "document_not_expired", // Expiry check result (boolean)
  "issuer_trusted",       // CSCA / IACA chain verified

  // Liveness / presence predicates.
  "liveness_verified",    // Face liveness check passed (boolean)
  "device_attested",      // App Attest / DeviceCheck OK (boolean)

  // Jurisdictional predicates.
  "jurisdiction_allowed", // Did this proof satisfy policy jurisdiction (boolean)
  "nationality_allowed",  // For passport flows (boolean, not the country code)
  "state_allowed",        // For DL flows (boolean, not the state code)

  // Policy context — public metadata, not user-identifying.
  "policy_id",            // UUID of the policy evaluated
  "policy_cid",           // Content address of the canonical policy
  "policy_name",          // Human-readable name: bar_us_21, adult_fr
  "policy_version",       // Semver of the policy

  // Assurance context — regulator/merchant-facing labels.
  "assurance_level",      // Merchant-facing marketing tier: always "maximum"
  "trust_tier_canonical", // Regulator-facing: ASL_1..ASL_6 (internal use; not sent to merchants)
  "nist_ial",             // NIST SP 800-63-4 IAL: IAL1/IAL2/IAL3
  "eidas_loa",            // eIDAS Level of Assurance: Low/Substantial/High

  // Temporal & correlation — UUIDs and timestamps, no user binding.
  "issued_at",            // ISO timestamp of verification
  "expires_at",           // ISO timestamp when attestation goes stale
  "request_id",           // UUID audit correlator
  "jti",                  // JWT ID for SD-JWT-VC replay protection

  // Cryptographic commitments — hashes, never raw values.
  "proof_asset_commitment",
  "proof_asset_id",       // UUID in PAR
  "circuit_version",      // e.g. "v1"
  "constraint_hash",      // Hash of the evaluated rules
  "policy_hash",          // Hash of the policy at evaluation time

  // Standard JWT/SD-JWT claims that do not expose PII.
  "iss",                  // Issuer DID
  "sub",                  // Subject (we use an ephemeral per-verification UUID, not a user ID)
  "aud",                  // Audience (merchant partner_id)
  "iat",                  // Issued at (numeric timestamp)
  "exp",                  // Expiry (numeric timestamp)
  "nbf",                  // Not before
  "cnf",                  // Confirmation key (public key binding the presentation)
  "_sd",                  // SD-JWT selective disclosure digests array
  "_sd_alg",              // SD-JWT digest algorithm
  "vct",                  // SD-JWT-VC type URI

  // ISO 18013-5 namespaced age predicates — standard mdoc element names.
  "org.iso.18013.5.1.age_over_13",
  "org.iso.18013.5.1.age_over_14",
  "org.iso.18013.5.1.age_over_15",
  "org.iso.18013.5.1.age_over_16",
  "org.iso.18013.5.1.age_over_17",
  "org.iso.18013.5.1.age_over_18",
  "org.iso.18013.5.1.age_over_19",
  "org.iso.18013.5.1.age_over_20",
  "org.iso.18013.5.1.age_over_21",
  "org.iso.18013.5.1.age_over_25",
  "org.iso.18013.5.1.age_over_65",
]);

// Claim names explicitly forbidden. Redundant with the allowlist's closed-world
// policy, but provides defense-in-depth and a source of error messages.
// If any of these appear in an emission attempt, the emitter must throw and log.
export const FORBIDDEN_CLAIM_NAMES: ReadonlySet<string> = new Set([
  // Name
  "name",
  "family_name",
  "given_name",
  "middle_name",
  "name_prefix",
  "name_suffix",
  "full_name",

  // DOB
  "birth_date",
  "date_of_birth",
  "dob",
  "birthday",

  // Address
  "address",
  "street_address",
  "resident_address",
  "resident_street",
  "resident_city",
  "resident_state",
  "resident_postal_code",
  "resident_country",

  // Document identifiers
  "document_number",
  "passport_number",
  "dl_number",
  "license_number",
  "id_number",

  // Document raw content
  "portrait",
  "portrait_image",
  "photo",
  "face_image",
  "mrz",
  "mrz_raw",
  "pdf417",
  "pdf417_raw",
  "barcode_raw",
  "aamva_raw",
  "document_image",
  "document_scan",
  "dg1",
  "dg2",
  "data_group_1",
  "data_group_2",
  "sod",

  // Direct identifiers
  "phone",
  "phone_number",
  "email",
  "email_address",
  "ip_address",
  "ssn",
  "sin",
  "national_id",

  // ISO 18013-5 raw attribute element names that must never be emitted
  "org.iso.18013.5.1.family_name",
  "org.iso.18013.5.1.given_name",
  "org.iso.18013.5.1.birth_date",
  "org.iso.18013.5.1.issue_date",
  "org.iso.18013.5.1.expiry_date",
  "org.iso.18013.5.1.issuing_country",
  "org.iso.18013.5.1.issuing_authority",
  "org.iso.18013.5.1.document_number",
  "org.iso.18013.5.1.portrait",
  "org.iso.18013.5.1.driving_privileges",
  "org.iso.18013.5.1.resident_address",
  "org.iso.18013.5.1.resident_city",
  "org.iso.18013.5.1.resident_state",
  "org.iso.18013.5.1.resident_postal_code",
  "org.iso.18013.5.1.resident_country",
  "org.iso.18013.5.1.nationality",
  "org.iso.18013.5.1.sex",
  "org.iso.18013.5.1.height",
  "org.iso.18013.5.1.weight",
  "org.iso.18013.5.1.eye_colour",
  "org.iso.18013.5.1.hair_colour",
  "org.iso.18013.5.1.birth_place",
  "org.iso.18013.5.1.signature_usual_mark",
]);

export class ClaimAllowlistError extends Error {
  constructor(public readonly claimName: string, public readonly reason: "not_allowlisted" | "forbidden") {
    super(`Claim "${claimName}" rejected by allowlist: ${reason}`);
    this.name = "ClaimAllowlistError";
  }
}

// Returns true if a claim name is permitted in outbound credential emission.
export function isPermittedClaim(claimName: string): boolean {
  if (FORBIDDEN_CLAIM_NAMES.has(claimName)) return false;
  return PERMITTED_CLAIM_NAMES.has(claimName);
}

// Throws ClaimAllowlistError if any key in `claims` is not permitted.
// Call this at the boundary of every credential emitter before signing.
export function assertClaimsAllowlisted(claims: Record<string, unknown>): void {
  for (const key of Object.keys(claims)) {
    if (FORBIDDEN_CLAIM_NAMES.has(key)) {
      throw new ClaimAllowlistError(key, "forbidden");
    }
    if (!PERMITTED_CLAIM_NAMES.has(key)) {
      throw new ClaimAllowlistError(key, "not_allowlisted");
    }
  }
}

// Strips forbidden/unknown claims, returns a new object with only allowlisted keys.
// Use for tolerant wrappers (e.g., passthrough from upstream credentials with extra claims).
// Logs each stripped claim to the caller-supplied log function for audit.
export function stripToAllowlist(
  claims: Record<string, unknown>,
  log: (msg: string) => void = () => {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(claims)) {
    if (PERMITTED_CLAIM_NAMES.has(key) && !FORBIDDEN_CLAIM_NAMES.has(key)) {
      out[key] = value;
    } else {
      log(`[claims-allowlist] stripped_claim=${key} reason=${FORBIDDEN_CLAIM_NAMES.has(key) ? "forbidden" : "not_allowlisted"}`);
    }
  }
  return out;
}
