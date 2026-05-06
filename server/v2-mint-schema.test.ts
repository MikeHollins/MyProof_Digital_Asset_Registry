// V2H.7 — V2 STRONG mint schema validation tests.
//
// Validates that the insertProofAssetSchema z.union accepts the V2-strong
// shape (with verification_metadata fully populated) AND the base shape
// (FAST and V1 STRONG mints, no V2 metadata), and rejects malformed inputs.
//
// These tests cover the SCHEMA invariant only — the full HTTP round-trip
// against a Neon test branch is deferred per V2H.7 rescoping (the schema
// captures the data shape PAR persists; full integration is exercised by
// existing route tests + the V1 PAR regression check post-V2H.7).

import { describe, it, expect } from "vitest";
import {
  insertProofAssetSchema,
  insertProofAssetV2StrongSchema,
  v2VerificationMetadataSchema,
} from "../shared/schema.js";

const BASE_VALID_MINT = {
  issuerDid: "did:web:api.myproof.ai:tenant:test",
  proofFormat: "ZK_PROOF",
  proofDigest: "a".repeat(64),
  digestAlg: "sha2-256",
  policyHash: "p".repeat(64),
  policyCid: "bafybeib".padEnd(59, "x"),
  constraintHash: "c".repeat(64),
  verifier_proof_ref: {
    proof_format: "ZK_PROOF",
    proof_uri: "https://example.com/proof",
    proof_digest: "a".repeat(64),
    digest_alg: "sha2-256",
  },
};

const VALID_DOC_COMMITMENT_HEX = "e805bb97455f57a680cc4bf83b78ff30" +
  "655041186a8dfd3e119032a265995ffb"; // 64 lowercase hex chars (V2 baseline)

describe("V2H.7 — V2 verification metadata schema", () => {
  it("accepts a valid V2 metadata block (full 64-char hex + positive circuit_version)", () => {
    const result = v2VerificationMetadataSchema.safeParse({
      doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
      circuit_version: 4,
    });
    expect(result.success).toBe(true);
  });

  it("rejects metadata with shortened doc_commitment_hex", () => {
    const result = v2VerificationMetadataSchema.safeParse({
      doc_commitment_hex: "e805bb97", // 8 chars, not 64
      circuit_version: 4,
    });
    expect(result.success).toBe(false);
  });

  it("rejects metadata with uppercase hex (case-sensitive 64-char regex)", () => {
    const result = v2VerificationMetadataSchema.safeParse({
      doc_commitment_hex: VALID_DOC_COMMITMENT_HEX.toUpperCase(),
      circuit_version: 4,
    });
    expect(result.success).toBe(false);
  });

  it("rejects metadata with non-hex characters", () => {
    const result = v2VerificationMetadataSchema.safeParse({
      doc_commitment_hex: "g".repeat(64), // 'g' is not a hex char
      circuit_version: 4,
    });
    expect(result.success).toBe(false);
  });

  it("rejects metadata with negative circuit_version", () => {
    const result = v2VerificationMetadataSchema.safeParse({
      doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
      circuit_version: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects metadata with zero circuit_version (positive integer required)", () => {
    const result = v2VerificationMetadataSchema.safeParse({
      doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
      circuit_version: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects metadata with non-integer circuit_version", () => {
    const result = v2VerificationMetadataSchema.safeParse({
      doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
      circuit_version: 4.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects metadata missing doc_commitment_hex (no half-V2)", () => {
    const result = v2VerificationMetadataSchema.safeParse({
      circuit_version: 4,
    });
    expect(result.success).toBe(false);
  });

  it("rejects metadata missing circuit_version (no half-V2)", () => {
    const result = v2VerificationMetadataSchema.safeParse({
      doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
    });
    expect(result.success).toBe(false);
  });
});

describe("V2H.7 — insertProofAssetSchema union (V2 STRONG ↔ base)", () => {
  it("accepts a base mint (no verification_metadata) — FAST or V1 STRONG path", () => {
    const result = insertProofAssetSchema.safeParse(BASE_VALID_MINT);
    expect(result.success).toBe(true);
  });

  it("accepts a V2 STRONG mint with full verification_metadata", () => {
    const result = insertProofAssetSchema.safeParse({
      ...BASE_VALID_MINT,
      verification_metadata: {
        doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
        circuit_version: 4,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a partial V2 mint (verification_metadata present but missing doc_commitment_hex)", () => {
    const v2StrongResult = insertProofAssetV2StrongSchema.safeParse({
      ...BASE_VALID_MINT,
      verification_metadata: {
        circuit_version: 4,
        // doc_commitment_hex absent
      },
    });
    expect(v2StrongResult.success).toBe(false);
  });

  it("rejects a partial V2 mint (verification_metadata present but missing circuit_version)", () => {
    const v2StrongResult = insertProofAssetV2StrongSchema.safeParse({
      ...BASE_VALID_MINT,
      verification_metadata: {
        doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
        // circuit_version absent
      },
    });
    expect(v2StrongResult.success).toBe(false);
  });

  it("base variant has no verification_metadata field at all (narrowing test)", () => {
    // The narrowed base shape has no verification_metadata field — the union
    // matches the V2-strong variant when it's present and base when it's absent.
    // The union itself accepts both cases.
    const baseResult = insertProofAssetSchema.safeParse(BASE_VALID_MINT);
    expect(baseResult.success).toBe(true);
    if (baseResult.success) {
      // No assertion on verification_metadata content — it shouldn't exist on the base shape.
      expect("verification_metadata" in baseResult.data).toBe(false);
    }
  });
});
