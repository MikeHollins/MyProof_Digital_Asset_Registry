import type { TrustLevel } from "./schema";

// Canonical trust-ladder translator.
// Single source of truth for cross-vocabulary mapping.
// Mirror of .agents/TRUST_LADDER.md — keep in sync with:
//   mobile-app/AgeProofClip/TrustTypes.swift:15-37 (code enum)
//   mobile-app/AgeProofClip/DZKPTrustSemantics.swift (derivation rule)
//   MyProof_Technical_White_Paper_v3.2.md §2.5 (ASL canon)
// See shared/schema.ts for the zod enum.

export type AssuranceLevel = "ASL_1" | "ASL_2" | "ASL_3" | "ASL_4" | "ASL_5" | "ASL_6";
export type MarketingTier = "standard" | "enhanced" | "maximum";
export type NistIAL = "IAL1" | "IAL2" | "IAL3";
export type EidasLoA = "Low" | "Substantial" | "High";

// Monotonic ordering for comparison.
// AUTH_SIGNALS (0) < AUTH_SIGNALS_DL (1) < PASSIVE_AUTH_HASH_ONLY (2) < CRYPTO_STRONG (3)
export const TRUST_ORDER: Record<TrustLevel, number> = {
  AUTH_SIGNALS: 0,
  AUTH_SIGNALS_DL: 1,
  PASSIVE_AUTH_HASH_ONLY: 2,
  CRYPTO_STRONG: 3,
};

// Policy enforcement: does `actual` meet or exceed `minimum`?
// Used server-side in proof-submit to reject proofs below policy threshold.
export function meetsMinimum(actual: TrustLevel, minimum: TrustLevel): boolean {
  return TRUST_ORDER[actual] >= TRUST_ORDER[minimum];
}

// Code → Canon mapping.
// ASL_2 is used when AUTH_SIGNALS_DL includes face/liveness; default to ASL_1 barcode-only.
// ASL_4 is used when CRYPTO_STRONG includes face/liveness.
export const TO_ASL_BASE: Record<TrustLevel, AssuranceLevel> = {
  AUTH_SIGNALS: "ASL_1",
  AUTH_SIGNALS_DL: "ASL_1",
  PASSIVE_AUTH_HASH_ONLY: "ASL_3",
  CRYPTO_STRONG: "ASL_3",
};

export function toASL(trust: TrustLevel, withLiveness: boolean = true): AssuranceLevel {
  if (!withLiveness) return TO_ASL_BASE[trust];
  if (trust === "AUTH_SIGNALS_DL") return "ASL_2";
  if (trust === "CRYPTO_STRONG") return "ASL_4";
  return TO_ASL_BASE[trust];
}

// Code → Marketing tier.
// AUTH_SIGNALS is not exposed publicly — it is a fallback path only.
// Callers should reject proofs at AUTH_SIGNALS before presenting a marketing label.
export function toMarketing(trust: TrustLevel): MarketingTier {
  switch (trust) {
    case "CRYPTO_STRONG":
      return "maximum";
    case "PASSIVE_AUTH_HASH_ONLY":
      return "enhanced";
    case "AUTH_SIGNALS_DL":
      return "standard";
    case "AUTH_SIGNALS":
      return "standard"; // fallback display only; policy enforcement rejects
  }
}

// Code → NIST SP 800-63-4 IAL mapping.
// Per research: CRYPTO_STRONG and AUTH_SIGNALS_DL both qualify as IAL2 evidence
// (SUPERIOR and STRONG respectively). AUTH_SIGNALS is IAL1.
export function toNistIAL(trust: TrustLevel): NistIAL {
  switch (trust) {
    case "CRYPTO_STRONG":
      return "IAL2";
    case "PASSIVE_AUTH_HASH_ONLY":
      return "IAL2";
    case "AUTH_SIGNALS_DL":
      return "IAL2";
    case "AUTH_SIGNALS":
      return "IAL1";
  }
}

// Code → eIDAS Level of Assurance.
// Substantial is the commercial tier for most age-verification flows;
// High is reserved for government-grade identity with qualified signature.
export function toEidas(trust: TrustLevel): EidasLoA {
  switch (trust) {
    case "CRYPTO_STRONG":
      return "Substantial"; // May reach High with remote-supervised step-up
    case "PASSIVE_AUTH_HASH_ONLY":
      return "Substantial";
    case "AUTH_SIGNALS_DL":
      return "Substantial";
    case "AUTH_SIGNALS":
      return "Low";
  }
}

// Server-side trust-level derivation from NFC fingerprint signals.
// Re-derives the trust level from the envelope's fingerprint claims so the server
// never has to trust the client's declared trust_level alone. Mirrors the Swift
// derivation at DZKPTrustSemantics.swift (DZKPTrustDeriver.deriveTrustLevel).
//
// PII INVARIANT: this function receives only boolean flags and hash fingerprints.
// No DG1/DG2 bytes, no MRZ, no portrait image. Inputs are already off-device safe.
export interface TrustDerivationInput {
  docType: "PASSPORT" | "DRIVERS_LICENSE" | "MOBILE_DL";
  paOk?: boolean;           // Passive Authentication signature valid
  dataGroupHashesMatch?: boolean;
  issuerChainTrusted?: boolean | null; // tri-state: true/false/null
  caOk?: boolean;           // Chip Authentication (reserved for future mDL + EAC)
}

export function deriveTrustLevel(input: TrustDerivationInput): TrustLevel {
  // DL path: no passport NFC. Optical-DL (PDF417 only) is always AUTH_SIGNALS_DL.
  //
  // FUTURE-PROOF: if a future DL flow ships issuer-signed NFC evidence
  // (e.g. mDL via ISO 18013-5 even while doc_type remains DRIVERS_LICENSE),
  // this branch MUST be revisited. Adding NFC fields for a DRIVERS_LICENSE
  // doc_type without updating this derivation would silently drop real
  // trust signals on the floor (§7 silent downgrade). See agentsoul.md §7.
  if (input.docType === "DRIVERS_LICENSE") {
    return "AUTH_SIGNALS_DL";
  }
  if (input.docType === "MOBILE_DL") {
    // mDL reserved for future. Until AAMVA VICAL + IACA chain verified server-side
    // this value will not be assignable in production.
    return input.caOk && input.issuerChainTrusted === true
      ? "CRYPTO_STRONG"
      : "AUTH_SIGNALS_DL";
  }
  // Passport path.
  if (input.paOk && input.dataGroupHashesMatch && input.issuerChainTrusted === true) {
    return "CRYPTO_STRONG";
  }
  if (input.dataGroupHashesMatch) {
    return "PASSIVE_AUTH_HASH_ONLY";
  }
  return "AUTH_SIGNALS";
}

// Display labels for UI — marketing tier + short description.
// Regulator-facing UI should additionally show the canonical ASL label.
export const MARKETING_LABELS: Record<MarketingTier, string> = {
  maximum: "Maximum Assurance",
  enhanced: "Enhanced Assurance",
  standard: "Standard Assurance",
};

export const ASL_LABELS: Record<AssuranceLevel, string> = {
  ASL_1: "ASL 1 — Basic signals",
  ASL_2: "ASL 2 — Basic signals + biometrics",
  ASL_3: "ASL 3 — NFC + passive auth",
  ASL_4: "ASL 4 — NFC + passive auth + biometrics",
  ASL_5: "ASL 5 — Mobile driver's license",
  ASL_6: "ASL 6 — Full IDV step-up",
};
