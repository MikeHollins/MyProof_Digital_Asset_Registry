/**
 * Digest normalization utilities
 * Handles conversion between hex (DB) and base64url (JWT/JWS) formats
 */

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Buffer {
  return Buffer.from(hex.toLowerCase(), "hex");
}

/**
 * Convert base64url to bytes
 */
export function b64uToBytes(b64u: string): Buffer {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

/**
 * Compare digest stored as hex (DB) vs base64url (receipt)
 * Returns true if they represent the same bytes
 */
export function digestsEqualHexVsB64u(dbHex: string, receiptB64u: string): boolean {
  try {
    const a = hexToBytes(dbHex);
    const b = b64uToBytes(receiptB64u);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert hex to base64url
 */
export function hexToB64u(hex: string): string {
  return Buffer.from(hex, "hex")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Convert base64url to hex
 */
export function b64uToHex(b64u: string): string {
  return b64uToBytes(b64u).toString("hex");
}
