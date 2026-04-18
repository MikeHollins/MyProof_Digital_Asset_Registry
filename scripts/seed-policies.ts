// Phase 1 seed script — 4 launch policies.
//
// Run: DATABASE_URL=... npx tsx scripts/seed-policies.ts
//
// Idempotent by (name, version): existing policies are not overwritten.
// Creates policies in "pending_signature" state — they are NOT effective
// until the admin signs each one via POST /api/admin/policies/:policyId/sign,
// after which a 24h delay-lock elapses before activation.
//
// Jurisdiction codes follow ISO 3166-1 alpha-2 for countries, and
// ISO 3166-2 for subdivisions (US-TX). Use "US-*" to mean any US state.
//
// Rule codes mirror mobile-app/AgeProofClip/ContentView.swift:1532-1612.
//   1 = AGE_OVER
//   2 = EXPIRY_OK
//   3 = NATIONALITY_IN
//   4 = STATE_IN
//   5 = STATE_NOT_IN
//   6 = DOC_TYPE_IN
//   7 = NATIONALITY_NOT_IN
//   8 = AGE_BETWEEN
//
// Doc type codes (for DOC_TYPE_IN list_params):
//   1 = PASSPORT
//   2 = DRIVERS_LICENSE
//   3 = MOBILE_DL (reserved)

import { createHash } from "crypto";
import { canonicalize } from "json-canonicalize";
import { eq, and } from "drizzle-orm";
import { db } from "../server/db.js";
import { policies, type PolicyRule, type TrustLevel } from "../shared/schema.js";

interface SeedPolicy {
  name: string;
  version: string;
  rules: readonly PolicyRule[];
  minTrustLevel: TrustLevel;
  ttlSeconds: number;
  jurisdiction: string;
  plainLanguage: string;
}

const SEEDS: readonly SeedPolicy[] = [
  {
    name: "bar_us_21",
    version: "1.0.0",
    rules: [
      { rule_type: "AGE_OVER", params: [21] },
      { rule_type: "EXPIRY_OK" },
    ],
    minTrustLevel: "AUTH_SIGNALS_DL",
    ttlSeconds: 86_400, // 24 hours
    jurisdiction: "US",
    plainLanguage: "Permits serving alcohol to patrons who prove they are 21 or older using a non-expired government identity document. Accepts US driver's licenses (AUTH_SIGNALS_DL) and passports. Proof is valid for 24 hours from issuance.",
  },
  {
    name: "dispensary_us_21",
    version: "1.0.0",
    rules: [
      { rule_type: "AGE_OVER", params: [21] },
      { rule_type: "EXPIRY_OK" },
      // State allowlist: AZ, CA, CO, IL, MA, MD, MI, MO, MT, NV, NJ, NM, NY, OR, RI, VA, VT, WA
      // State codes map to FIPS or ISO 3166-2 numeric representations used in the circuit.
      { rule_type: "STATE_IN", list_params: [2, 4, 5, 9, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26], list_count: 18 },
    ],
    minTrustLevel: "AUTH_SIGNALS_DL",
    ttlSeconds: 604_800, // 7 days
    jurisdiction: "US",
    plainLanguage: "Permits sale of adult-use cannabis products to patrons who prove they are 21 or older in a state where adult-use cannabis is legal. Proof is valid for 7 days from issuance.",
  },
  {
    name: "bank_us_18_kyc",
    version: "1.0.0",
    rules: [
      { rule_type: "AGE_OVER", params: [18] },
      { rule_type: "EXPIRY_OK" },
      { rule_type: "DOC_TYPE_IN", list_params: [1, 2], list_count: 2 }, // Passport or DL
    ],
    minTrustLevel: "CRYPTO_STRONG",
    ttlSeconds: 7_776_000, // 90 days
    jurisdiction: "US",
    plainLanguage: "Permits onboarding a financial services customer who proves they are 18 or older using a non-expired passport or driver's license, with cryptographically verified issuer trust chain. Proof is valid for 90 days to cover regulated customer due-diligence refresh cycles.",
  },
  {
    name: "adult_fr",
    version: "1.0.0",
    rules: [
      { rule_type: "AGE_OVER", params: [18] },
      { rule_type: "EXPIRY_OK" },
      { rule_type: "DOC_TYPE_IN", list_params: [1], list_count: 1 }, // Passport only
    ],
    minTrustLevel: "CRYPTO_STRONG",
    ttlSeconds: 15_552_000, // 180 days — per ARCOM référentiel freshness cap
    jurisdiction: "FR",
    plainLanguage: "Permits access to adult-restricted online content in France to users who prove they are 18 or older, per ARCOM référentiel technique (9 octobre 2024). Requires cryptographically verified passport with CSCA chain of trust and the site must implement double anonymity. Proof is valid for 180 days.",
  },
];

function computePolicyCid(p: SeedPolicy, previousVersionHash: string | null): string {
  const canonical = canonicalize({
    name: p.name,
    version: p.version,
    rules: p.rules,
    min_trust_level: p.minTrustLevel,
    ttl_seconds: p.ttlSeconds,
    jurisdiction: p.jurisdiction,
    plain_language: p.plainLanguage,
    previous_version_hash: previousVersionHash,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

async function run(): Promise<void> {
  console.log("[seed-policies] starting seed");
  let inserted = 0;
  let skipped = 0;

  for (const seed of SEEDS) {
    const existing = await db
      .select()
      .from(policies)
      .where(and(eq(policies.name, seed.name), eq(policies.version, seed.version)))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[seed-policies] skip name=${seed.name} version=${seed.version} (already exists)`);
      skipped++;
      continue;
    }

    const policyCid = computePolicyCid(seed, null);
    const result = await db.insert(policies).values({
      policyCid,
      name: seed.name,
      version: seed.version,
      previousVersionHash: null, // First version of each policy
      rules: seed.rules,
      minTrustLevel: seed.minTrustLevel,
      ttlSeconds: seed.ttlSeconds,
      jurisdiction: seed.jurisdiction,
      plainLanguage: seed.plainLanguage,
    }).returning();

    console.log(`[seed-policies] inserted name=${seed.name} version=${seed.version} cid=${policyCid.substring(0, 24)}... policy_id=${result[0].policyId}`);
    inserted++;
  }

  console.log(`[seed-policies] done. inserted=${inserted} skipped=${skipped} total=${SEEDS.length}`);
  console.log(`[seed-policies] NOTE: all inserted policies are in pending_signature state.`);
  console.log(`[seed-policies]       They will become effective only after admin signs each via`);
  console.log(`[seed-policies]       POST /api/admin/policies/:policyId/sign + 24h delay-lock.`);
}

run().catch((err) => {
  console.error("[seed-policies] FAILED", err);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
