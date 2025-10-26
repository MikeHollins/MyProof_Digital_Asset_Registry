import { jwtVerify, decodeProtectedHeader } from "jose";
import { verifyZk, type ZkFormat } from "./zkVerifier.js";

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
 * Verify ZK_PROOF using snarkjs
 * 
 * Expected JSON payload format:
 * {
 *   "system": "GROTH16" | "PLONK",
 *   "vKey": {...},           // verification key
 *   "publicSignals": [...],  // public inputs
 *   "proof": {...}           // proof object
 * }
 */
async function verifyZkProof(bytes: Uint8Array): Promise<VerifyResult> {
  try {
    // Parse as JSON proof object
    const txt = Buffer.from(bytes).toString("utf8");
    const payload = JSON.parse(txt);

    // Validate required fields
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: "invalid_proof_structure" };
    }

    if (!payload.system || !payload.vKey || !payload.publicSignals || !payload.proof) {
      return { ok: false, reason: "zk_payload_missing_fields" };
    }

    // Validate system type
    const validSystems: ZkFormat[] = ["GROTH16", "PLONK"];
    if (!validSystems.includes(payload.system)) {
      return { ok: false, reason: "unsupported_zk_system" };
    }

    // Perform actual ZK verification using snarkjs
    const result = await verifyZk(
      payload.system as ZkFormat,
      payload.vKey,
      payload.publicSignals,
      payload.proof
    );

    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }

    return {
      ok: true,
      metadata: {
        system: payload.system,
        verified: "snarkjs",
        publicSignalsCount: payload.publicSignals.length,
      },
    };
  } catch (e: any) {
    return { ok: false, reason: String(e.message || e) };
  }
}
