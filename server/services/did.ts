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

/**
 * Resolve a DID to its DID Document
 * @param did - Decentralized Identifier (e.g., did:web:example.com, did:ethr:0x...)
 * @returns DID Resolution result with DID Document
 */
export async function resolveDid(did: string) {
  return resolver.resolve(did);
}

export interface DidCheckResult {
  ok: boolean;
  code?: string;
  reason?: string;
  doc?: any;
}

/**
 * Check if a DID is usable (resolves and has verification methods)
 * 
 * Minimal issuer check:
 * - Resolves DID Document
 * - Confirms at least one publicKey / verificationMethod exists
 * 
 * @param did - Decentralized Identifier to check
 * @returns Check result with ok flag, error code, and optional reason
 */
export async function isDidUsable(did: string): Promise<DidCheckResult> {
  try {
    // Validate DID format
    if (!did || !did.startsWith("did:")) {
      return {
        ok: false,
        code: "INVALID_DID_FORMAT",
        reason: "DID must start with 'did:' prefix",
      };
    }

    const result = await resolveDid(did);
    
    if (!result || !result.didDocument) {
      return {
        ok: false,
        code: "DID_NOT_RESOLVED",
        reason: "DID resolution failed - document not found",
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

    return { ok: true, doc: result.didDocument };
  } catch (e: any) {
    // Log internally for debugging but don't expose raw errors to clients
    console.error("[did-resolver] Resolution error:", {
      did: did.substring(0, 20) + "...",
      error: e.message,
    });
    
    return {
      ok: false,
      code: "DID_RESOLUTION_ERROR",
      reason: "Failed to resolve DID - resolver unavailable or network error",
    };
  }
}
