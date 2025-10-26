import { jwtVerify, decodeProtectedHeader } from "jose";

/**
 * Fresh-proof verification service
 * 
 * Verifies proof bytes by format (VC_JWT, ZK_PROOF, etc.)
 * Phase 2: Implement VC_JWT and ZK_PROOF stubs
 * Phase 3: Add full snarkjs verification for ZK proofs
 */

interface VerifyResult {
  ok: boolean;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * Verify fresh proof bytes by format
 * 
 * @param format - Proof format (VC_JWT, ZK_PROOF, etc.)
 * @param bytes - Proof bytes to verify
 * @returns Verification result with ok flag and optional reason/metadata
 */
export async function verifyFreshProof(
  format: string,
  bytes: Uint8Array
): Promise<VerifyResult> {
  try {
    if (format === "VC_JWT" || format === "JWS") {
      return await verifyVcJwt(bytes);
    }

    if (format === "ZK_PROOF") {
      return await verifyZkProof(bytes);
    }

    // Other formats: stub to ok:true for now
    // Future: Add support for TPM_ATTESTATION, HW_SECURE_ELEMENT, etc.
    return { ok: true, metadata: { format, verified: "stub" } };
  } catch (e: any) {
    return { ok: false, reason: String(e.message || e) };
  }
}

/**
 * Verify VC_JWT / JWS proof
 * 
 * Phase 2: Basic structural validation (3-part JWT)
 * Phase 3: Full signature verification against JWKS
 */
async function verifyVcJwt(bytes: Uint8Array): Promise<VerifyResult> {
  try {
    const txt = Buffer.from(bytes).toString("utf8");
    const parts = txt.split(".");

    if (parts.length !== 3) {
      return { ok: false, reason: "malformed_jwt" };
    }

    // Decode header to check algorithm
    const header = decodeProtectedHeader(txt);
    if (!header.alg || header.alg === "none") {
      return { ok: false, reason: "invalid_algorithm" };
    }

    // Phase 2: Accept as valid if structurally correct
    // Phase 3: Verify signature against expected issuer JWKS
    // For now, just ensure it looks like a valid JWT
    return {
      ok: true,
      metadata: {
        alg: header.alg,
        typ: header.typ,
        verified: "structure_only",
      },
    };
  } catch (e: any) {
    return { ok: false, reason: String(e.message || e) };
  }
}

/**
 * Verify ZK_PROOF
 * 
 * Phase 2: Stub to ok:true
 * Phase 3: Call snarkjs.groth16.verify with vKey if available
 */
async function verifyZkProof(bytes: Uint8Array): Promise<VerifyResult> {
  try {
    // Parse as JSON proof object
    const txt = Buffer.from(bytes).toString("utf8");
    const proof = JSON.parse(txt);

    // Basic validation: ensure it has proof structure
    if (!proof || typeof proof !== "object") {
      return { ok: false, reason: "invalid_proof_structure" };
    }

    // Phase 2: Stub verification
    // Phase 3: Call snarkjs verification
    // const vKey = await loadVerificationKey(proof.circuitId);
    // const publicSignals = proof.publicSignals || [];
    // const valid = await snarkjs.groth16.verify(vKey, publicSignals, proof.proof);

    return {
      ok: true,
      metadata: {
        verified: "stub",
        note: "Phase 3 will add full snarkjs verification",
      },
    };
  } catch (e: any) {
    return { ok: false, reason: String(e.message || e) };
  }
}
