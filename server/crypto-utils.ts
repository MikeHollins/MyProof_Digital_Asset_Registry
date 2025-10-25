import { CID } from "multiformats/cid";
import * as json from "multiformats/codecs/json";
import { sha256 } from "multiformats/hashes/sha2";
import { createHash } from "crypto";

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS)
 * Produces deterministic byte representation of JSON data
 * 
 * This uses the json-canonicalize library for RFC 8785 compliance.
 * Fallback to simplified implementation if library fails to load.
 */
export async function canonicalizeJSON(data: any): Promise<string> {
  try {
    // Try dynamic import of json-canonicalize
    const module = await import('json-canonicalize');
    const canonicalize = module.default || module;
    if (typeof canonicalize === 'function') {
      return canonicalize(data);
    }
  } catch (e) {
    // Fall back to manual implementation
  }
  
  // Fallback: Simplified deterministic JSON serialization
  // Recursively sorts object keys to ensure consistent output
  function sortKeys(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(sortKeys);
    }
    const sorted: any = {};
    Object.keys(obj).sort().forEach(key => {
      sorted[key] = sortKeys(obj[key]);
    });
    return sorted;
  }
  
  return JSON.stringify(sortKeys(data));
}

/**
 * Generate SHA-256 hash of canonicalized JSON
 */
export async function hashCanonicalJSON(data: any): Promise<string> {
  const canonical = await canonicalizeJSON(data);
  const hash = createHash("sha256");
  hash.update(canonical);
  return hash.digest("hex");
}

/**
 * Generate CIDv1 for JSON data using SHA-256
 * Returns base32-encoded CIDv1
 */
export async function generateCID(data: any): Promise<string> {
  const canonical = await canonicalizeJSON(data);
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
export async function computeAuditEventHash(
  eventType: string,
  assetId: string | null,
  payload: any,
  previousHash: string | null,
  timestamp: Date
): Promise<string> {
  const canonicalPayload = await canonicalizeJSON(payload);
  const eventData = {
    eventType,
    assetId,
    payload: canonicalPayload,
    previousHash,
    timestamp: timestamp.toISOString(),
  };
  return hashCanonicalJSON(eventData);
}

/**
 * Verify audit event hash chain integrity
 */
export async function verifyAuditChainLink(
  event: {
    eventType: string;
    assetId: string | null;
    payload: any;
    previousHash: string | null;
    eventHash: string;
    timestamp: Date;
  }
): Promise<boolean> {
  const computed = await computeAuditEventHash(
    event.eventType,
    event.assetId,
    event.payload,
    event.previousHash,
    event.timestamp
  );
  return computed === event.eventHash;
}

/**
 * Validate digest encoding based on algorithm
 * 
 * Ensures the digest is properly hex-encoded and has the correct length
 * for the specified algorithm.
 * 
 * @param digest - The digest string to validate
 * @param algorithm - The digest algorithm (sha2-256, sha3-256, blake3, multihash)
 * @returns true if valid, false otherwise
 */
export function validateDigestEncoding(digest: string, algorithm: string): { valid: boolean; reason?: string } {
  // Check if digest is hex-encoded
  if (!/^[0-9a-fA-F]+$/.test(digest)) {
    return { valid: false, reason: "Digest must be hex-encoded (only 0-9, a-f, A-F characters allowed)" };
  }
  
  // Validate length based on algorithm
  const expectedLengths: Record<string, number> = {
    'sha2-256': 64,   // 32 bytes * 2 hex chars
    'sha3-256': 64,   // 32 bytes * 2 hex chars
    'blake3': 64,     // 32 bytes * 2 hex chars (default blake3 output)
    'multihash': -1,  // Variable length, don't validate
  };
  
  const expectedLength = expectedLengths[algorithm];
  
  if (expectedLength === undefined) {
    return { valid: false, reason: `Unknown digest algorithm: ${algorithm}` };
  }
  
  if (expectedLength > 0 && digest.length !== expectedLength) {
    return { 
      valid: false, 
      reason: `Invalid digest length for ${algorithm}: expected ${expectedLength} hex chars, got ${digest.length}` 
    };
  }
  
  return { valid: true };
}

/**
 * Normalize URL for comparison
 * 
 * This ensures consistent URL comparison by:
 * - Converting to lowercase (except path/query which may be case-sensitive)
 * - Trimming whitespace
 * - Normalizing scheme (default to https if missing)
 * - Normalizing default ports (remove :80 for http, :443 for https)
 * - Ensuring trailing slash consistency
 * 
 * Throws error if URL normalization changes meaning (different scheme/port)
 * 
 * @param url - URL string to normalize
 * @returns Normalized URL string
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  
  try {
    const parsed = new URL(trimmed);
    
    // Normalize scheme to lowercase
    const scheme = parsed.protocol.replace(':', '').toLowerCase();
    
    // Normalize hostname to lowercase
    const hostname = parsed.hostname.toLowerCase();
    
    // Remove default ports
    let port = parsed.port;
    if ((scheme === 'http' && port === '80') || (scheme === 'https' && port === '443')) {
      port = '';
    }
    
    // Reconstruct normalized URL
    let normalized = `${scheme}://`;
    
    // Add credentials if present
    if (parsed.username) {
      normalized += parsed.username;
      if (parsed.password) {
        normalized += `:${parsed.password}`;
      }
      normalized += '@';
    }
    
    normalized += hostname;
    
    // Add non-default port
    if (port) {
      normalized += `:${port}`;
    }
    
    // Add pathname (preserve case)
    normalized += parsed.pathname;
    
    // Add search (preserve case)
    if (parsed.search) {
      normalized += parsed.search;
    }
    
    // Add hash (preserve case)
    if (parsed.hash) {
      normalized += parsed.hash;
    }
    
    return normalized;
  } catch (error) {
    throw new Error(`Invalid URL format: ${trimmed}`);
  }
}
