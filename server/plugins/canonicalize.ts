import * as canonicalizeModule from "json-canonicalize";
import { createHash } from "node:crypto";

// Handle default export from json-canonicalize
const canonicalize = (canonicalizeModule as any).default || canonicalizeModule;

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS)
 * Deterministic serialization for cryptographic hashing
 */
export function jcs(input: unknown): string {
  return canonicalize(input);
}

/**
 * SHA-256 hex digest from bytes or string
 */
export function sha256Hex(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Generate cryptographic commitment from payload
 * Uses RFC 8785 canonicalization + SHA-256
 */
export function commitmentHex(payloadForCommitment: unknown): string {
  const canonical = jcs(payloadForCommitment);
  return sha256Hex(canonical);
}
