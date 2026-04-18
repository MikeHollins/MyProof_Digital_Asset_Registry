// Client-side mirror of shared/trust-ladder.ts. Type-only import avoided;
// UI duplicates the constants so the client bundle does not pull server deps.
// Must stay byte-for-byte consistent with shared/trust-ladder.ts mappings.

export type TrustLevel =
  | "CRYPTO_STRONG"
  | "PASSIVE_AUTH_HASH_ONLY"
  | "AUTH_SIGNALS_DL"
  | "AUTH_SIGNALS";

export type MarketingTier = "standard" | "enhanced" | "maximum";
export type NistIAL = "IAL1" | "IAL2" | "IAL3";
export type EidasLoA = "Low" | "Substantial" | "High";
export type AssuranceLevel = "ASL_1" | "ASL_2" | "ASL_3" | "ASL_4" | "ASL_5" | "ASL_6";

export const TRUST_ORDER: Record<TrustLevel, number> = {
  AUTH_SIGNALS: 0,
  AUTH_SIGNALS_DL: 1,
  PASSIVE_AUTH_HASH_ONLY: 2,
  CRYPTO_STRONG: 3,
};

export function toMarketing(trust: TrustLevel): MarketingTier {
  switch (trust) {
    case "CRYPTO_STRONG": return "maximum";
    case "PASSIVE_AUTH_HASH_ONLY": return "enhanced";
    case "AUTH_SIGNALS_DL": return "standard";
    case "AUTH_SIGNALS": return "standard";
  }
}

export function toASL(trust: TrustLevel, withLiveness: boolean = true): AssuranceLevel {
  if (!withLiveness) {
    if (trust === "AUTH_SIGNALS") return "ASL_1";
    if (trust === "AUTH_SIGNALS_DL") return "ASL_1";
    return "ASL_3";
  }
  if (trust === "AUTH_SIGNALS") return "ASL_1";
  if (trust === "AUTH_SIGNALS_DL") return "ASL_2";
  if (trust === "CRYPTO_STRONG") return "ASL_4";
  return "ASL_3";
}

export function toNistIAL(trust: TrustLevel): NistIAL {
  return trust === "AUTH_SIGNALS" ? "IAL1" : "IAL2";
}

export function toEidas(trust: TrustLevel): EidasLoA {
  return trust === "AUTH_SIGNALS" ? "Low" : "Substantial";
}

// Display labels
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

export const MARKETING_COLOR: Record<MarketingTier, string> = {
  maximum: "bg-green-600 text-white",
  enhanced: "bg-blue-600 text-white",
  standard: "bg-amber-500 text-white",
};
