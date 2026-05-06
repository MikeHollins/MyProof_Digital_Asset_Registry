/**
 * V2H.8 — Pure runtime narrowing of `proof_assets.verification_metadata`
 * JSONB content. Extracts the V2 STRONG-tier shape `{ doc_commitment_hex,
 * circuit_version }` if present and well-formed, returns null otherwise so
 * the admin UI can auto-hide the section for V1 STRONG and FAST mints.
 *
 * Mirrors the validation contract enforced by PAR's mint endpoint (see
 * `MyProof_Digital_Asset_Registry/shared/schema.ts v2VerificationMetadataSchema`).
 * Living here as a pure function (vs inline in the dialog component) keeps
 * the narrowing testable without React Testing Library or jsdom.
 */

export interface V2VerificationMetadata {
  doc_commitment_hex: string; // exactly 64 lowercase hex chars
  circuit_version: number;    // positive integer
}

export function extractV2VerificationMetadata(
  metadata: unknown,
): V2VerificationMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;

  if (typeof m.doc_commitment_hex !== "string") return null;
  if (!/^[0-9a-f]{64}$/.test(m.doc_commitment_hex)) return null;

  if (typeof m.circuit_version !== "number") return null;
  if (!Number.isInteger(m.circuit_version)) return null;
  if (m.circuit_version <= 0) return null;

  return {
    doc_commitment_hex: m.doc_commitment_hex,
    circuit_version: m.circuit_version,
  };
}
