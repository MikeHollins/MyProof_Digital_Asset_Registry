// V2H.8 — Pure narrowing helper for V2 STRONG verification metadata in PAR
// admin UI. Tests the runtime type-check that decides whether the
// "Verification Metadata" section in ProofDetailsDialog renders or auto-hides.

import { describe, it, expect } from "vitest";
import { extractV2VerificationMetadata } from "./v2VerificationMetadata";

const VALID_DOC_COMMITMENT_HEX =
  "e805bb97455f57a680cc4bf83b78ff30" +
  "655041186a8dfd3e119032a265995ffb"; // 64 lowercase hex chars

describe("extractV2VerificationMetadata", () => {
  it("returns the V2 metadata object when both fields are well-formed", () => {
    const result = extractV2VerificationMetadata({
      doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
      circuit_version: 4,
    });
    expect(result).toEqual({
      doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
      circuit_version: 4,
    });
  });

  it("returns null for null input (V1 STRONG / FAST mints have no metadata)", () => {
    expect(extractV2VerificationMetadata(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractV2VerificationMetadata(undefined)).toBeNull();
  });

  it("returns null for empty object (no V2 fields present)", () => {
    expect(extractV2VerificationMetadata({})).toBeNull();
  });

  it("returns null when doc_commitment_hex is missing", () => {
    expect(extractV2VerificationMetadata({ circuit_version: 4 })).toBeNull();
  });

  it("returns null when circuit_version is missing", () => {
    expect(
      extractV2VerificationMetadata({
        doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
      }),
    ).toBeNull();
  });

  it("returns null when doc_commitment_hex is too short", () => {
    expect(
      extractV2VerificationMetadata({
        doc_commitment_hex: "e805bb97", // 8 chars
        circuit_version: 4,
      }),
    ).toBeNull();
  });

  it("returns null when doc_commitment_hex is uppercase (regex is case-sensitive)", () => {
    expect(
      extractV2VerificationMetadata({
        doc_commitment_hex: VALID_DOC_COMMITMENT_HEX.toUpperCase(),
        circuit_version: 4,
      }),
    ).toBeNull();
  });

  it("returns null when doc_commitment_hex contains non-hex characters", () => {
    expect(
      extractV2VerificationMetadata({
        doc_commitment_hex: "g".repeat(64), // 'g' not in [0-9a-f]
        circuit_version: 4,
      }),
    ).toBeNull();
  });

  it("returns null when circuit_version is zero", () => {
    expect(
      extractV2VerificationMetadata({
        doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
        circuit_version: 0,
      }),
    ).toBeNull();
  });

  it("returns null when circuit_version is negative", () => {
    expect(
      extractV2VerificationMetadata({
        doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
        circuit_version: -1,
      }),
    ).toBeNull();
  });

  it("returns null when circuit_version is a non-integer", () => {
    expect(
      extractV2VerificationMetadata({
        doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
        circuit_version: 4.5,
      }),
    ).toBeNull();
  });

  it("returns null when circuit_version is a string (type guard)", () => {
    expect(
      extractV2VerificationMetadata({
        doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
        circuit_version: "4",
      }),
    ).toBeNull();
  });

  it("returns null when input is a primitive (string)", () => {
    expect(extractV2VerificationMetadata("not an object")).toBeNull();
  });

  it("ignores extra keys and returns only the V2 fields (V2H.7 mint merges with derivedFacts)", () => {
    // The PAR mint endpoint merges the V2 metadata INTO the JWS-derived
    // derivedFacts blob — meaning verification_metadata in production carries
    // BOTH the V2 fields and JWS facts (issuer, audience, etc). The narrowing
    // helper only extracts the V2 fields and ignores the rest.
    const result = extractV2VerificationMetadata({
      doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
      circuit_version: 4,
      issuer: "did:web:api.myproof.ai:tenant:test",
      audience: "myproof-registry",
      claims: { foo: "bar" },
    });
    expect(result).toEqual({
      doc_commitment_hex: VALID_DOC_COMMITMENT_HEX,
      circuit_version: 4,
    });
  });
});
