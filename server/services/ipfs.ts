import { create } from "ipfs-http-client";
import { CID } from "multiformats/cid";

// IPFS HTTP API endpoint (default to local node)
const IPFS_API = process.env.IPFS_API || "http://127.0.0.1:5001";

let ipfsClient: ReturnType<typeof create> | null = null;

/**
 * Get or create IPFS HTTP client
 * Lazy initialization to handle missing IPFS node gracefully
 */
function getIpfsClient() {
  if (!ipfsClient) {
    ipfsClient = create({ url: IPFS_API });
  }
  return ipfsClient;
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
  try {
    const ipfs = getIpfsClient();
    const { cid } = await ipfs.add(JSON.stringify(obj));
    return { ok: true, data: cid.toString() };
  } catch (error: any) {
    return {
      ok: false,
      error: "Failed to pin content to IPFS",
      code: "IPFS_PIN_FAILED",
    };
  }
}

/**
 * Retrieve and parse JSON from IPFS by CID
 * @param cidStr - CIDv1 string to fetch
 * @returns Result with parsed JSON object or error
 */
export async function getJson(cidStr: string): Promise<IpfsResult<any>> {
  try {
    // Validate CID format first
    try {
      CID.parse(cidStr);
    } catch {
      return {
        ok: false,
        error: "Invalid CID format",
        code: "INVALID_CID",
      };
    }

    const ipfs = getIpfsClient();
    const chunks: Uint8Array[] = [];
    
    for await (const chunk of ipfs.cat(cidStr)) {
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
    const parsed = JSON.parse(buf.toString("utf8"));
    return { ok: true, data: parsed };
  } catch (error: any) {
    if (error.message?.includes("JSON")) {
      return {
        ok: false,
        error: "Invalid JSON content",
        code: "INVALID_JSON",
      };
    }
    return {
      ok: false,
      error: "Failed to fetch from IPFS",
      code: "IPFS_FETCH_FAILED",
    };
  }
}

/**
 * Check if IPFS node is available
 * @returns true if IPFS node responds, false otherwise
 */
export async function isIpfsAvailable(): Promise<boolean> {
  try {
    const ipfs = getIpfsClient();
    await ipfs.id();
    return true;
  } catch {
    return false;
  }
}
