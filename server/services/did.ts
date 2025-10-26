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
 * @returns Check result with ok flag, optional reason, and DID Document
 */
export async function isDidUsable(did: string): Promise<DidCheckResult> {
  try {
    const result = await resolveDid(did);
    
    if (!result || !result.didDocument) {
      return { ok: false, reason: "did_not_resolve" };
    }

    const vm = result.didDocument.verificationMethod || [];
    if (!vm.length) {
      return { ok: false, reason: "no_verification_method" };
    }

    return { ok: true, doc: result.didDocument };
  } catch (e: any) {
    return { ok: false, reason: String(e.message || e) };
  }
}
