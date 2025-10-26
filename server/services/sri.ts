import { createHash } from "node:crypto";

/**
 * SRI (Subresource Integrity) utilities for fresh-proof verification
 * 
 * Enforces:
 * - HTTPS-only with allowlisted hosts
 * - Size caps (128KB default)
 * - Timeout protection (3s default)
 * - Digest validation before accepting proof bytes
 */

const ALLOW_HTTPS_HOSTS = new Set([
  "localhost:5000",
  "127.0.0.1:5000",
  "cdn.myproof.ai",
]);

const MAX_BYTES = parseInt(process.env.PROOF_MAX_SIZE_BYTES || "131072", 10); // 128 KB
const TIMEOUT_MS = parseInt(process.env.PROOF_FETCH_TIMEOUT_MS || "3000", 10); // 3s

/**
 * Fetch proof bytes from HTTPS URI with SRI validation
 * 
 * @param proofUri - HTTPS URL to fetch proof from
 * @param expectedDigestB64u - Expected SHA-256 digest in base64url encoding
 * @returns Proof bytes as Uint8Array
 * @throws Error if scheme not HTTPS, host not allowlisted, fetch fails, size exceeded, or digest mismatch
 */
export async function fetchWithSRI(
  proofUri: string,
  expectedDigestB64u: string
): Promise<Uint8Array> {
  let u: URL;
  try {
    u = new URL(proofUri);
  } catch {
    throw new Error("invalid_proof_uri");
  }

  // Enforce HTTPS-only (critical for SRI integrity)
  // Exception: Allow http:// ONLY for localhost in development mode
  const isLocalhost = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  const isDev = process.env.NODE_ENV !== "production";

  if (u.protocol !== "https:") {
    if (u.protocol === "http:" && isLocalhost && isDev) {
      // Allow http://localhost in dev only
      console.warn("[SRI] WARNING: Accepting HTTP for localhost in dev mode");
    } else {
      throw new Error("unsupported_scheme_https_required");
    }
  }

  // Check host allowlist
  if (process.env.PROOF_ALLOWED_HOSTS) {
    // Production mode: strict allowlist from env var
    const allowed = new Set(process.env.PROOF_ALLOWED_HOSTS.split(","));
    if (!allowed.has(u.host)) {
      throw new Error("origin_not_allowlisted");
    }
  } else if (!ALLOW_HTTPS_HOSTS.has(u.host)) {
    // Dev mode: use default allowlist
    throw new Error("origin_not_allowlisted");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(proofUri, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`fetch_failed_${res.status}`);
    }

    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        throw new Error("payload_too_large");
      }
      chunks.push(value);
    }

    const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));

    // Verify SRI digest
    const digest = Buffer.from(createHash("sha256").update(bytes).digest()).toString(
      "base64url"
    );
    if (digest !== expectedDigestB64u) {
      throw new Error("sri_digest_mismatch");
    }

    return new Uint8Array(bytes);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Decode base64url-encoded proof bytes
 * 
 * @param b64u - Base64url string
 * @returns Decoded buffer
 * @throws Error if invalid encoding
 */
export function decodeB64u(b64u: string): Buffer {
  try {
    return Buffer.from(b64u.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    throw new Error("invalid_proof_bytes");
  }
}
