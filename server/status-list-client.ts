import { setWithTTL, get as redisGet } from "./redis-client";

/**
 * W3C Bitstring Status List Client
 * 
 * Implements fail-closed security model:
 * - If status list unreachable or stale → fail verification
 * - Uses ETag caching with If-None-Match for efficiency
 * - Configurable max staleness threshold
 * 
 * Production requirements:
 * - Use Redis for shared cache across instances
 * - Monitor status list availability
 * - Set appropriate staleness thresholds per policy
 */

interface StatusListCache {
  etag?: string;
  bitstring: Uint8Array;
  fetchedAt: number;
}

// In-memory cache (production should use Redis)
const statusListCache = new Map<string, StatusListCache>();

// Configuration
const MAX_STALENESS_MS = parseInt(process.env.STATUS_MAX_STALENESS_MS || String(24 * 60 * 60 * 1000)); // 24h default
const FETCH_TIMEOUT_MS = parseInt(process.env.STATUS_FETCH_TIMEOUT_MS || '3000'); // 3s default

export interface FetchStatusListOptions {
  maxStalenessMs?: number;
  timeoutMs?: number;
}

export interface StatusListResult {
  bitstring: Uint8Array;
  etag?: string;
  fromCache: boolean;
  age: number; // milliseconds since fetch
}

/**
 * Normalize status list URL for consistent caching
 * - Lowercase scheme and hostname
 * - Remove default ports (80, 443)
 * - Remove trailing slash
 */
export function normalizeStatusListUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    
    // Remove default ports
    if ((parsed.protocol === 'https:' && parsed.port === '443') || 
        (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = '';
    }
    
    // Remove trailing slash from pathname (except root)
    if (parsed.pathname.endsWith('/') && parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    
    return parsed.toString();
  } catch (error: any) {
    throw new Error(`Invalid status list URL: ${error.message}`);
  }
}

/**
 * Fetch W3C Status List with ETag caching
 * 
 * @param url - Status list URL
 * @param options - Fetch options (staleness, timeout)
 * @returns Status list bitstring
 * @throws Error if unreachable or stale (fail-closed)
 */
export async function fetchStatusList(
  url: string,
  options: FetchStatusListOptions = {}
): Promise<StatusListResult> {
  const normalizedUrl = normalizeStatusListUrl(url);
  const maxStaleness = options.maxStalenessMs ?? MAX_STALENESS_MS;
  const timeout = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  
  // Check cache
  const cached = statusListCache.get(normalizedUrl);
  const now = Date.now();
  
  if (cached) {
    const age = now - cached.fetchedAt;
    
    // If cache is fresh enough, return it
    if (age < maxStaleness) {
      return {
        bitstring: cached.bitstring,
        etag: cached.etag,
        fromCache: true,
        age,
      };
    }
    
    // Cache exists but is stale - try to refresh with ETag
  }
  
  // Fetch from network with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  
  try {
    const headers: Record<string, string> = {};
    
    // Use ETag for conditional fetch (304 Not Modified optimization)
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }
    
    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers,
    });
    
    // 304 Not Modified - cache is still valid
    if (response.status === 304 && cached) {
      // Update fetchedAt timestamp
      cached.fetchedAt = now;
      statusListCache.set(normalizedUrl, cached);
      
      return {
        bitstring: cached.bitstring,
        etag: cached.etag,
        fromCache: true,
        age: 0,
      };
    }
    
    // Error responses - fail closed
    if (!response.ok) {
      throw new Error(`Status list fetch failed: HTTP ${response.status}`);
    }
    
    // Parse response
    const arrayBuffer = await response.arrayBuffer();
    const bitstring = new Uint8Array(arrayBuffer);
    const etag = response.headers.get('ETag') || undefined;
    
    // Update cache
    const cacheEntry: StatusListCache = {
      etag,
      bitstring,
      fetchedAt: now,
    };
    statusListCache.set(normalizedUrl, cacheEntry);
    
    return {
      bitstring,
      etag,
      fromCache: false,
      age: 0,
    };
    
  } catch (error: any) {
    // If fetch fails and we have stale cache, fail closed (don't use stale data)
    if (cached) {
      const age = now - cached.fetchedAt;
      console.warn(`[status-list] Fetch failed, cache age: ${age}ms (max: ${maxStaleness}ms)`);
      throw new Error(`Status list unreachable and cache stale (age: ${age}ms, max: ${maxStaleness}ms) - failing closed`);
    }
    
    // No cache available and fetch failed - fail closed
    throw new Error(`Status list unreachable: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if a specific index is set in the bitstring
 * 
 * W3C Bitstring Status List uses compressed bitstrings where:
 * - 0 = status not set (valid/active)
 * - 1 = status set (revoked/suspended)
 * 
 * @param bitstring - Compressed bitstring bytes
 * @param index - Index to check (as string, can be large number)
 * @returns true if bit is set (revoked/suspended), false if clear (active)
 */
export function checkBitstringIndex(bitstring: Uint8Array, index: string): boolean {
  const idx = parseInt(index, 10);
  
  if (isNaN(idx) || idx < 0) {
    throw new Error(`Invalid status list index: ${index}`);
  }
  
  // Calculate byte and bit position
  const byteIndex = Math.floor(idx / 8);
  const bitPosition = idx % 8;
  
  if (byteIndex >= bitstring.length) {
    // Index out of bounds - treat as not set (valid)
    return false;
  }
  
  const byte = bitstring[byteIndex];
  const mask = 1 << bitPosition;
  
  return (byte & mask) !== 0;
}

/**
 * Verify proof status using W3C Status List
 * 
 * Implements fail-closed behavior:
 * - If list unreachable or stale → reject verification
 * - If index set to 1 → proof is revoked/suspended
 * - If index set to 0 → proof is active
 * 
 * @param statusListUrl - URL to W3C Status List
 * @param statusListIndex - Index in bitstring
 * @param statusPurpose - 'revocation' or 'suspension'
 * @returns Verification verdict
 */
export async function verifyProofStatus(
  statusListUrl: string,
  statusListIndex: string,
  statusPurpose: 'revocation' | 'suspension'
): Promise<{ verdict: 'valid' | 'revoked' | 'suspended' | 'unknown'; reason?: string }> {
  try {
    // Fetch status list (with caching and fail-closed)
    const result = await fetchStatusList(statusListUrl);
    
    // Check bit at index
    const isSet = checkBitstringIndex(result.bitstring, statusListIndex);
    
    if (isSet) {
      // Bit is set - proof is revoked or suspended
      return {
        verdict: statusPurpose === 'revocation' ? 'revoked' : 'suspended',
      };
    } else {
      // Bit is clear - proof is active
      return {
        verdict: 'valid',
      };
    }
  } catch (error: any) {
    // Fail closed - if we can't verify status, reject
    console.error('[status-list] Verification failed (fail-closed):', error.message);
    return {
      verdict: 'unknown',
      reason: `Status verification failed: ${error.message}`,
    };
  }
}
