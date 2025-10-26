import * as snarkjs from "snarkjs";

export type ZkFormat = "GROTH16" | "PLONK";

export interface ZkVerificationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify a zero-knowledge proof using snarkjs
 * @param format - ZK proof system (GROTH16 or PLONK)
 * @param vKey - Verification key JSON (trusted setup)
 * @param publicSignals - Array of public signals/inputs
 * @param proof - Proof object from the prover
 * @returns Verification result with ok flag and optional reason
 */
export async function verifyZk(
  format: ZkFormat,
  vKey: any,
  publicSignals: any[],
  proof: any
): Promise<ZkVerificationResult> {
  try {
    if (format === "GROTH16") {
      const res = await snarkjs.groth16.verify(vKey, publicSignals, proof);
      return { ok: !!res, reason: res ? undefined : "verify_failed" };
    }
    
    if (format === "PLONK") {
      const res = await snarkjs.plonk.verify(vKey, publicSignals, proof);
      return { ok: !!res, reason: res ? undefined : "verify_failed" };
    }
    
    return { ok: false, reason: "unsupported_format" };
  } catch (e: any) {
    return { ok: false, reason: String(e.message || e) };
  }
}
