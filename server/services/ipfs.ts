import { create } from "ipfs-http-client";
import { CID } from "multiformats/cid";
import { createHash } from "node:crypto";
import * as multihash from "multiformats/hashes/digest";

// IPFS gateway failover configuration
const GATEWAYS = [
  process.env.IPFS_API?.replace(/\/+$/, '') || "http://127.0.0.1:5001",
  "https://ipfs.io/api/v0",
  "https://cloudflare-ipfs.com/api/v0"
];

const MAX_CONTENT_SIZE = 2 * 1024 * 1024; // 2MB safety cap

function makeClient(url: string) {
  return create({ url });
}

export type IpfsResult<T> = 
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

/**
 * Pin JSON object to IPFS and return CIDv1 string
 * @param obj - JSON-serializable object to pin
 * @returns Result with CIDv1 string or error
 */
export async function pinJson(obj: any): Promise<IpfsResult<string>> {
  let lastGateway = "";
  
  for (const gw of GATEWAYS) {
    lastGateway = gw;
    try {
      const ipfs = makeClient(gw);
      const { cid } = await ipfs.add(JSON.stringify(obj));
      return { ok: true, data: cid.toString() };
    } catch (error: any) {
      console.error(`[ipfs] ${gw} pin failed:`, error.message);
      // Try next gateway
    }
  }
  
  return {
    ok: false,
    error: `All IPFS gateways failed (last: ${lastGateway})`,
    code: "IPFS_PIN_FAILED",
  };
}

/**
 * Retrieve and parse JSON from IPFS by CID with multi-gateway fallback
 * @param cidStr - CIDv1 string to fetch
 * @returns Result with parsed JSON object or error
 */
export async function getJson(cidStr: string): Promise<IpfsResult<any>> {
  // Validate and parse CID
  let parsedCid: CID;
  try {
    parsedCid = CID.parse(cidStr);
  } catch {
    return {
      ok: false,
      error: "Invalid CID format",
      code: "INVALID_CID",
    };
  }

  let lastGateway = "";
  
  for (const gw of GATEWAYS) {
    lastGateway = gw;
    try {
      const ipfs = makeClient(gw);
      const hasher = createHash('sha256'); // Stream to hash for validation
      let total = 0;
      const chunks: Uint8Array[] = [];
      
      for await (const chunk of ipfs.cat(cidStr)) {
        total += chunk.byteLength;
        
        // Memory protection: enforce size cap
        if (total > MAX_CONTENT_SIZE) {
          return {
            ok: false,
            error: "Content exceeds 2MB size limit",
            code: "IPFS_SIZE_CAP",
          };
        }
        
        hasher.update(chunk);
        chunks.push(chunk);
      }
      
      if (chunks.length === 0) {
        return {
          ok: false,
          error: "Content not found",
          code: "IPFS_NOT_FOUND",
        };
      }

      const buf = Buffer.concat(chunks);
      const computedHash = hasher.digest();
      
      // Verify content integrity: compare computed hash with CID's multihash
      const cidMultihash = parsedCid.multihash.digest; // Extract digest bytes
      
      // For SHA-256 CIDs (code 0x12), verify the digest matches
      if (parsedCid.multihash.code === 0x12) { // SHA-256
        if (!computedHash.equals(Buffer.from(cidMultihash))) {
          console.error(`[ipfs] ${gw} integrity check failed: computed hash does not match CID`);
          // Try next gateway - content may be corrupted
          continue;
        }
      }
      
      // Parse JSON
      try {
        const parsed = JSON.parse(buf.toString("utf8"));
        return { ok: true, data: parsed };
      } catch (jsonError: any) {
        return {
          ok: false,
          error: "Invalid JSON content",
          code: "INVALID_JSON",
        };
      }
    } catch (error: any) {
      console.error(`[ipfs] ${gw} fetch failed:`, error.message);
      // Try next gateway
    }
  }
  
  return {
    ok: false,
    error: `All IPFS gateways failed (last: ${lastGateway})`,
    code: "IPFS_FETCH_FAILED",
  };
}

/**
 * Fetch raw bytes from IPFS with multi-gateway fallback and memory protection
 * @param cidStr - CIDv1 string to fetch
 * @returns Result with Buffer or error
 */
export async function fetchFromIPFS(cidStr: string): Promise<IpfsResult<Buffer>> {
  // Validate and parse CID
  let parsedCid: CID;
  try {
    parsedCid = CID.parse(cidStr);
  } catch {
    return {
      ok: false,
      error: "Invalid CID format",
      code: "INVALID_CID",
    };
  }

  let lastGateway = "";
  
  for (const gw of GATEWAYS) {
    lastGateway = gw;
    try {
      const ipfs = makeClient(gw);
      const hasher = createHash('sha256'); // Stream to hash for validation
      let total = 0;
      const chunks: Uint8Array[] = [];
      
      for await (const chunk of ipfs.cat(cidStr)) {
        total += chunk.byteLength;
        
        // Memory protection: enforce size cap
        if (total > MAX_CONTENT_SIZE) {
          return {
            ok: false,
            error: "Content exceeds 2MB size limit",
            code: "IPFS_SIZE_CAP",
          };
        }
        
        hasher.update(chunk);
        chunks.push(chunk);
      }
      
      const content = Buffer.concat(chunks);
      const computedHash = hasher.digest();
      
      // Verify content integrity: compare computed hash with CID's multihash
      // CID.multihash contains the hash algorithm identifier + digest
      const cidMultihash = parsedCid.multihash.digest; // Extract digest bytes
      
      // For SHA-256 CIDs (code 0x12), verify the digest matches
      if (parsedCid.multihash.code === 0x12) { // SHA-256
        if (!computedHash.equals(Buffer.from(cidMultihash))) {
          console.error(`[ipfs] ${gw} integrity check failed: computed hash does not match CID`);
          // Try next gateway - content may be corrupted
          continue;
        }
      }
      // For other hash algorithms, we trust the gateway for now
      // (can add more hash algorithm support as needed)
      
      return { ok: true, data: content };
    } catch (error: any) {
      console.error(`[ipfs] ${gw} fetch failed:`, error.message);
      // Try next gateway
    }
  }
  
  return {
    ok: false,
    error: `All IPFS gateways failed (last: ${lastGateway})`,
    code: "IPFS_FETCH_FAILED",
  };
}

/**
 * Check if IPFS node is available
 * @returns true if IPFS node responds, false otherwise
 */
export async function isIpfsAvailable(): Promise<boolean> {
  for (const gw of GATEWAYS) {
    try {
      const ipfs = makeClient(gw);
      await ipfs.id();
      return true;
    } catch {
      // Try next gateway
    }
  }
  return false;
}
