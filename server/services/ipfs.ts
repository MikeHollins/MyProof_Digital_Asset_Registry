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

/**
 * Pin JSON object to IPFS and return CIDv1 string
 * @param obj - JSON-serializable object to pin
 * @returns CIDv1 string (content identifier)
 */
export async function pinJson(obj: any): Promise<string> {
  const ipfs = getIpfsClient();
  const { cid } = await ipfs.add(JSON.stringify(obj));
  return cid.toString();
}

/**
 * Retrieve and parse JSON from IPFS by CID
 * @param cidStr - CIDv1 string to fetch
 * @returns Parsed JSON object
 */
export async function getJson(cidStr: string): Promise<any> {
  const ipfs = getIpfsClient();
  const chunks: Uint8Array[] = [];
  
  for await (const chunk of ipfs.cat(cidStr)) {
    chunks.push(chunk);
  }
  
  const buf = Buffer.concat(chunks);
  return JSON.parse(buf.toString("utf8"));
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
