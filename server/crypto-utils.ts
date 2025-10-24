import canonicalize from "json-canonicalize";
import { CID } from "multiformats/cid";
import * as json from "multiformats/codecs/json";
import { sha256 } from "multiformats/hashes/sha2";
import { createHash } from "crypto";

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS)
 * Produces deterministic byte representation of JSON data
 */
export function canonicalizeJSON(data: any): string {
  return canonicalize(data);
}

/**
 * Generate SHA-256 hash of canonicalized JSON
 */
export function hashCanonicalJSON(data: any): string {
  const canonical = canonicalizeJSON(data);
  const hash = createHash("sha256");
  hash.update(canonical);
  return hash.digest("hex");
}

/**
 * Generate CIDv1 for JSON data using SHA-256
 * Returns base32-encoded CIDv1
 */
export async function generateCID(data: any): Promise<string> {
  const canonical = canonicalizeJSON(data);
  const bytes = new TextEncoder().encode(canonical);
  const hash = await sha256.digest(bytes);
  const cid = CID.create(1, json.code, hash);
  return cid.toString();
}

/**
 * Generate proof asset commitment using CIDv1
 * This creates a content-addressable identifier for the proof configuration
 */
export async function generateProofCommitment(commitmentData: {
  policy_cid: string;
  policy_hash: string;
  constraint_cid?: string | null;
  constraint_hash: string;
  circuit_cid?: string | null;
  schema_cid?: string | null;
  license?: any;
  proof_id: string;
}): Promise<string> {
  return generateCID(commitmentData);
}

/**
 * Compute SHA-256 hash for audit event with previous hash linking
 */
export function computeAuditEventHash(
  eventType: string,
  assetId: string | null,
  payload: any,
  previousHash: string | null,
  timestamp: Date
): string {
  const eventData = {
    eventType,
    assetId,
    payload: canonicalizeJSON(payload),
    previousHash,
    timestamp: timestamp.toISOString(),
  };
  return hashCanonicalJSON(eventData);
}

/**
 * Verify audit event hash chain integrity
 */
export function verifyAuditChainLink(
  event: {
    eventType: string;
    assetId: string | null;
    payload: any;
    previousHash: string | null;
    eventHash: string;
    timestamp: Date;
  }
): boolean {
  const computed = computeAuditEventHash(
    event.eventType,
    event.assetId,
    event.payload,
    event.previousHash,
    event.timestamp
  );
  return computed === event.eventHash;
}
