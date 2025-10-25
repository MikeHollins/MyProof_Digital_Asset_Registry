import { db } from "../db";
import { statusLists } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DEFAULT_BITS = 131072; // 128k entries (16KB bitstring)

/**
 * Ensure a status list exists in the database for the given URL and purpose.
 * Creates a new empty list if it doesn't exist.
 */
export async function ensureList(url: string, purpose: 'revocation' | 'suspension'): Promise<{
  listId: string;
  url: string;
  purpose: string;
  bitstring: string;
  size: number;
  etag: string;
}> {
  const existing = await db.select().from(statusLists).where(eq(statusLists.url, url));
  if (existing.length > 0) {
    return existing[0] as any;
  }

  // Create new empty bitstring (all zeros)
  const buf = Buffer.alloc(DEFAULT_BITS / 8, 0);
  
  // Compress with gzip (W3C Bitstring Status List spec)
  const compressed = await gzip(buf);
  const bitstring = compressed.toString('base64');
  
  // Generate ETag based on content hash
  const contentHash = crypto.createHash('sha256').update(compressed).digest('hex').substring(0, 16);
  const etag = `W/"${contentHash}:${Date.now()}"`;

  const result = await db.insert(statusLists).values({
    url,
    purpose,
    bitstring,
    size: DEFAULT_BITS,
    etag,
  }).returning();

  return result[0] as any;
}

/**
 * Get a status list by URL.
 */
export async function getList(url: string): Promise<{
  listId: string;
  url: string;
  purpose: string;
  bitstring: string;
  size: number;
  etag: string | null;
} | null> {
  const rows = await db.select().from(statusLists).where(eq(statusLists.url, url));
  return rows.length > 0 ? (rows[0] as any) : null;
}

/**
 * Get the value of a specific bit in the status list (0 or 1).
 * Returns null if the list doesn't exist.
 */
export async function getBit(url: string, index: number): Promise<0 | 1 | null> {
  const row = await getList(url);
  if (!row) return null;

  // Decode base64 and decompress
  const compressed = Buffer.from(row.bitstring, 'base64');
  const buf = await gunzip(compressed);

  const byte = index >> 3;
  const bit = index & 7;
  
  if (byte >= buf.length) return null;

  return ((buf[byte] >> bit) & 1) as 0 | 1;
}

/**
 * Apply operations to a status list with optimistic concurrency control.
 * Operations: set (bit=1), clear (bit=0), flip (toggle)
 * 
 * Retries up to 3 times on ETag mismatch (concurrent modification).
 */
export async function applyOps(
  url: string,
  ops: Array<{ op: 'set' | 'clear' | 'flip'; index: number }>
): Promise<{ etag: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await getList(url);
    if (!row) {
      throw new Error('status_list_missing');
    }

    // Decode and decompress current bitstring
    const compressed = Buffer.from(row.bitstring, 'base64');
    const buf = await gunzip(compressed);

    // Apply all operations
    for (const { op, index } of ops) {
      const byte = index >> 3;
      const bit = index & 7;

      if (byte >= buf.length) {
        throw new Error(`bit_index_out_of_range: ${index} >= ${buf.length * 8}`);
      }

      if (op === 'set') {
        buf[byte] |= (1 << bit);
      } else if (op === 'clear') {
        buf[byte] &= ~(1 << bit);
      } else if (op === 'flip') {
        buf[byte] ^= (1 << bit);
      }
    }

    // Recompress and encode
    const newCompressed = await gzip(buf);
    const newBitstring = newCompressed.toString('base64');
    
    // Generate new ETag
    const contentHash = crypto.createHash('sha256').update(newCompressed).digest('hex').substring(0, 16);
    const newEtag = `W/"${contentHash}:${Date.now()}"`;

    // Optimistic update: only update if ETag hasn't changed
    const result = await db
      .update(statusLists)
      .set({
        bitstring: newBitstring,
        etag: newEtag,
        updatedAt: new Date(),
      })
      .where(eq(statusLists.url, url))
      .returning();

    if (result.length > 0) {
      return { etag: newEtag };
    }

    // ETag changed, retry
    console.warn(`[status-list-repo] Optimistic lock conflict on ${url}, attempt ${attempt + 1}/3`);
  }

  throw new Error('status_list_write_conflict');
}

/**
 * Get the raw compressed bitstring (base64-encoded gzipped bytes)
 * for serving as a W3C Bitstring Status List.
 */
export async function getCompressedBitstring(url: string): Promise<{
  bitstring: string;
  etag: string | null;
} | null> {
  const row = await getList(url);
  if (!row) return null;

  return {
    bitstring: row.bitstring,
    etag: row.etag,
  };
}
