import { Resolver } from "did-resolver";
import { getResolver as ethrGetResolver } from "ethr-did-resolver";
import { getResolver as webGetResolver } from "web-did-resolver";

// Initialize DID resolvers for different methods
const ethr = ethrGetResolver({
  networks: [
    {
      name: "mainnet",
      rpcUrl: process.env.ETH_RPC_URL || "https://cloudflare-eth.com",
    },
  ],
});

const web = webGetResolver();

// Create universal DID resolver
const resolver = new Resolver({
  ...ethr,
  ...web,
  // Add more method resolvers as needed (key, ion, etc.)
});

// Method allow-list for v1 (block unsupported methods early)
const ALLOWED_METHODS = new Set(['did:web', 'did:ethr']);

// Simple in-memory cache with TTL
const CACHE = new Map<string, { doc: any; ts: number }>();
const TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Resolve a DID to its DID Document with timeout
 * @param did - Decentralized Identifier (e.g., did:web:example.com, did:ethr:0x...)
 * @param timeoutMs - Timeout in milliseconds (default: 3000)
 * @returns DID Resolution result with DID Document
 */
export async function resolveDid(did: string, timeoutMs: number = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const result = await resolver.resolve(did, { signal: controller.signal as any });
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export interface DidCheckResult {
  ok: boolean;
  code?: string;
  reason?: string;
  doc?: any;
}

/**
 * Check if a DID is usable with timeout, caching, and method allow-list
 * 
 * Features:
 * - 3-second timeout to prevent stalls
 * - 10-minute cache to reduce resolver calls
 * - Method allow-list (web, ethr only in v1)
 * - Verification method validation
 * 
 * @param did - Decentralized Identifier to check
 * @param timeoutMs - Optional timeout override (default: 3000ms)
 * @returns Check result with ok flag, error code, and optional reason
 */
export async function isDidUsable(did: string, timeoutMs: number = 3000): Promise<DidCheckResult> {
  try {
    // Validate DID format
    if (!did || !did.startsWith("did:")) {
      return {
        ok: false,
        code: "INVALID_DID_FORMAT",
        reason: "DID must start with 'did:' prefix",
      };
    }

    // Extract and validate method
    const method = did.split(':').slice(0, 2).join(':');
    if (!ALLOWED_METHODS.has(method)) {
      return {
        ok: false,
        code: "METHOD_NOT_SUPPORTED",
        reason: `DID method ${method} is not supported in this version`,
      };
    }

    // Check cache first
    const cached = CACHE.get(did);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      return { ok: true, doc: cached.doc };
    }

    // Resolve with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const result = await resolver.resolve(did, { signal: controller.signal as any });
      
      if (!result || !result.didDocument) {
        return {
          ok: false,
          code: "DID_NOT_RESOLVED",
          reason: "DID resolution failed - document not found",
        };
      }

      if (result.didResolutionMetadata.error) {
        return {
          ok: false,
          code: "DID_RESOLUTION_ERROR",
          reason: result.didResolutionMetadata.error,
        };
      }

      const vm = result.didDocument.verificationMethod || [];
      if (!vm.length) {
        return {
          ok: false,
          code: "NO_VERIFICATION_METHOD",
          reason: "DID document has no verification methods",
        };
      }

      // Cache successful resolution
      CACHE.set(did, { doc: result.didDocument, ts: Date.now() });

      return { ok: true, doc: result.didDocument };
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: any) {
    // Detect timeout vs other errors
    if (e.name === 'AbortError' || e.message?.includes('abort')) {
      console.error("[did-resolver]", did.split(':').slice(0, 2).join(':'), "timeout:", e.message);
      return {
        ok: false,
        code: "DID_TIMEOUT",
        reason: "DID resolution timed out",
      };
    }
    
    // Log internally for debugging but don't expose raw errors to clients
    console.error("[did-resolver]", did.split(':').slice(0, 2).join(':'), "error:", e.message);
    
    return {
      ok: false,
      code: "DID_RESOLUTION_ERROR",
      reason: "Failed to resolve DID - resolver unavailable or network error",
    };
  }
}

/**
 * Clear the DID cache (useful for testing or forced refresh)
 */
export function clearDidCache() {
  CACHE.clear();
}
