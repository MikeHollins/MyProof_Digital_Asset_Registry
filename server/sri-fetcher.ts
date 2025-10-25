import { createHash } from "crypto";

/**
 * Subresource Integrity (SRI) Proof Fetcher
 * 
 * Implements secure proof fetching for fresh-proof verification with:
 * - HTTPS-only enforcement
 * - Host allowlist
 * - Size and timeout caps
 * - Streaming digest validation
 * - Abort on mismatch
 * 
 * Security: Never stores proof bytes - validates digest then passes to verifier
 */

// Configuration
const PROOF_MAX_SIZE_BYTES = parseInt(process.env.PROOF_MAX_SIZE_BYTES || String(128 * 1024)); // 128KB default
const PROOF_FETCH_TIMEOUT_MS = parseInt(process.env.PROOF_FETCH_TIMEOUT_MS || '3000'); // 3s default

// Host allowlist for proof URIs (production should maintain strict list)
// For development, allow any HTTPS host
const ALLOWED_HOSTS = new Set(
  (process.env.PROOF_ALLOWED_HOSTS || '').split(',').filter(Boolean)
);

export interface FetchProofOptions {
  maxSizeBytes?: number;
  timeoutMs?: number;
  allowAnyHost?: boolean; // Only for development
}

/**
 * Fetch proof with Subresource Integrity validation
 * 
 * Security guarantees:
 * - Only fetches from HTTPS URLs (enforced)
 * - Validates host against allowlist (production)
 * - Enforces size cap (prevents DoS)
 * - Enforces timeout (prevents hanging)
 * - Validates digest matches expected value
 * - Rejects on any mismatch
 * 
 * @param proofUri - HTTPS URL or CID reference
 * @param expectedDigest - Expected SHA-256 digest (hex-encoded)
 * @param options - Fetch options
 * @returns Proof bytes (only if digest matches)
 * @throws Error if fetch fails, digest mismatch, or policy violation
 */
export async function fetchProofWithSRI(
  proofUri: string,
  expectedDigest: string,
  options: FetchProofOptions = {}
): Promise<Uint8Array> {
  const maxSize = options.maxSizeBytes ?? PROOF_MAX_SIZE_BYTES;
  const timeout = options.timeoutMs ?? PROOF_FETCH_TIMEOUT_MS;
  const allowAnyHost = options.allowAnyHost ?? (process.env.NODE_ENV !== 'production');
  
  // Parse and validate URL
  let url: URL;
  try {
    url = new URL(proofUri);
  } catch (error: any) {
    throw new Error(`Invalid proof URI: ${error.message}`);
  }
  
  // Enforce HTTPS-only (security requirement)
  if (url.protocol !== 'https:') {
    // In development, allow data: URIs for testing
    if (url.protocol === 'data:' && process.env.NODE_ENV !== 'production') {
      return fetchDataUri(url.href, expectedDigest);
    }
    throw new Error(`Unsupported protocol: ${url.protocol}. Only HTTPS allowed for proof fetching.`);
  }
  
  // Check host allowlist (production security)
  if (!allowAnyHost && !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Host not in allowlist: ${url.hostname}. Configure PROOF_ALLOWED_HOSTS environment variable.`);
  }
  
  // Fetch with timeout and size limits
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url.href, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'PAR-Registry/1.0',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Proof fetch failed: HTTP ${response.status} ${response.statusText}`);
    }
    
    if (!response.body) {
      throw new Error('No response body received');
    }
    
    // Stream with size cap and digest validation
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const hash = createHash('sha256');
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      // Enforce size cap (prevent DoS)
      totalBytes += value.byteLength;
      if (totalBytes > maxSize) {
        reader.cancel();
        throw new Error(`Proof exceeds maximum size: ${totalBytes} > ${maxSize} bytes`);
      }
      
      // Update hash
      hash.update(value);
      chunks.push(value);
    }
    
    // Validate digest (SRI)
    const computedDigest = hash.digest('hex').toLowerCase();
    const normalizedExpected = expectedDigest.toLowerCase();
    
    if (computedDigest !== normalizedExpected) {
      throw new Error(`SRI digest mismatch: expected ${normalizedExpected}, got ${computedDigest}`);
    }
    
    // Concatenate chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    
    return result;
    
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Handle data: URIs for testing (development only)
 */
function fetchDataUri(dataUri: string, expectedDigest: string): Uint8Array {
  try {
    // Parse data URI: data:[<mediatype>][;base64],<data>
    const match = dataUri.match(/^data:([^;,]*)(;base64)?,(.*)$/);
    if (!match) {
      throw new Error('Invalid data URI format');
    }
    
    const [, , isBase64, data] = match;
    let bytes: Uint8Array;
    
    if (isBase64) {
      bytes = Uint8Array.from(Buffer.from(data, 'base64'));
    } else {
      bytes = Uint8Array.from(Buffer.from(decodeURIComponent(data), 'utf8'));
    }
    
    // Validate digest
    const hash = createHash('sha256');
    hash.update(bytes);
    const computedDigest = hash.digest('hex').toLowerCase();
    const normalizedExpected = expectedDigest.toLowerCase();
    
    if (computedDigest !== normalizedExpected) {
      throw new Error(`SRI digest mismatch for data URI: expected ${normalizedExpected}, got ${computedDigest}`);
    }
    
    return bytes;
  } catch (error: any) {
    throw new Error(`Failed to parse data URI: ${error.message}`);
  }
}

/**
 * Validate that a proof URI is acceptable
 * 
 * @param proofUri - URI to validate
 * @returns true if acceptable, false otherwise
 */
export function isValidProofUri(proofUri: string): boolean {
  try {
    const url = new URL(proofUri);
    
    // Production: HTTPS only
    if (process.env.NODE_ENV === 'production') {
      return url.protocol === 'https:';
    }
    
    // Development: HTTPS or data:
    return url.protocol === 'https:' || url.protocol === 'data:';
  } catch {
    return false;
  }
}
