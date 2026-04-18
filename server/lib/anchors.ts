// External tamper-evidence anchors for epoch roots.
//
// Each anchor is independent and recoverable: if any one anchor fails, the
// others still carry the epoch's existence proof. The publisher fans out to
// all configured anchors in parallel and records which succeeded in the
// epoch's anchor_status column.
//
// Phase 2 anchors:
//   - Sigstore public RFC 3161 TSA    (free, signed by Sigstore, no auth)
//   - FreeTSA.org RFC 3161 TSA        (free, community-run, no auth)
//   - Sigstore Rekor v2 hashedrekord  (public transparency log)
//   - Cloudflare R2 WORM backup       (object-lock enabled; stub until wrangler auth)
//
// Phase 5 adds: eIDAS-qualified QTSP RFC 3161 (e.g. GlobalSign), paid tier
// activated on first EU enterprise sign-up via env var EIDAS_QTSA_URL.

// ---------------------------------------------------------------------------
// RFC 3161 fan-out.
//
// Per RFC 3161, a TimeStampRequest is a DER-encoded ASN.1 structure:
//   TimeStampReq ::= SEQUENCE {
//     version                    INTEGER (v1 = 1),
//     messageImprint             MessageImprint,
//     reqPolicy                  TSAPolicyID OPTIONAL,
//     nonce                      INTEGER OPTIONAL,
//     certReq                    BOOLEAN DEFAULT FALSE,
//     ...
//   }
//
// We build a minimal v1 request with SHA-256 imprint + random nonce + certReq=true
// so verifiers can chain the TSA's signing cert offline.

import { createHash, randomBytes } from "crypto";

export interface Rfc3161TsaTarget {
  name: string;
  url: string;
  eidasQualified?: boolean;
}

export const DEFAULT_TSAS: readonly Rfc3161TsaTarget[] = [
  { name: "sigstore", url: "https://timestamp.sigstore.dev/api/v1/timestamp" },
  { name: "freetsa", url: "https://freetsa.org/tsr" },
];

export interface Rfc3161Result {
  tsa_url: string;
  token_b64: string;
  issued_at: string;
}

// Encode an ASN.1 length octet(s) (DER). Used to build the TSR request.
function encodeLength(len: number): Buffer {
  if (len < 128) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.concat([Buffer.from([0x80 | bytes.length]), Buffer.from(bytes)]);
}

function derSequence(inner: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x30]), encodeLength(inner.length), inner]);
}
function derOctetString(content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x04]), encodeLength(content.length), content]);
}
function derInteger(bytes: Buffer): Buffer {
  // Ensure positive interpretation: if high bit is set on first byte, prepend 0x00.
  const content = bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0x00]), bytes]) : bytes;
  return Buffer.concat([Buffer.from([0x02]), encodeLength(content.length), content]);
}
function derOid(oid: number[]): Buffer {
  const bytes: number[] = [];
  bytes.push(oid[0] * 40 + oid[1]);
  for (let i = 2; i < oid.length; i++) {
    let v = oid[i];
    const chunk: number[] = [];
    do {
      chunk.unshift(v & 0x7f);
      v >>= 7;
    } while (v > 0);
    for (let j = 0; j < chunk.length - 1; j++) chunk[j] |= 0x80;
    bytes.push(...chunk);
  }
  return Buffer.concat([Buffer.from([0x06]), encodeLength(bytes.length), Buffer.from(bytes)]);
}
function derBoolean(v: boolean): Buffer {
  return Buffer.from([0x01, 0x01, v ? 0xff : 0x00]);
}

// OID 2.16.840.1.101.3.4.2.1 = sha-256
const OID_SHA256 = derOid([2, 16, 840, 1, 101, 3, 4, 2, 1]);

// Build an RFC 3161 TimeStampReq for a SHA-256 hash, with nonce + certReq.
export function buildRfc3161Request(sha256HashHex: string): Buffer {
  const version = derInteger(Buffer.from([0x01]));
  // AlgorithmIdentifier ::= SEQUENCE { algorithm OID, parameters NULL }
  const algorithmId = derSequence(Buffer.concat([OID_SHA256, Buffer.from([0x05, 0x00])]));
  const hashOctet = derOctetString(Buffer.from(sha256HashHex, "hex"));
  const messageImprint = derSequence(Buffer.concat([algorithmId, hashOctet]));
  const nonce = derInteger(randomBytes(16));
  const certReq = derBoolean(true);
  return derSequence(Buffer.concat([version, messageImprint, nonce, certReq]));
}

const FETCH_TIMEOUT_MS = 5_000;

export async function requestTimestamp(
  tsa: Rfc3161TsaTarget,
  sha256HashHex: string,
): Promise<Rfc3161Result> {
  const req = buildRfc3161Request(sha256HashHex);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(tsa.url, {
      method: "POST",
      headers: {
        "content-type": "application/timestamp-query",
        accept: "application/timestamp-reply",
      },
      body: req,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`${tsa.name} returned HTTP ${res.status}`);
    }
    const body = Buffer.from(await res.arrayBuffer());
    return {
      tsa_url: tsa.url,
      token_b64: body.toString("base64"),
      issued_at: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Fan out to every TSA in parallel. Returns successful tokens + failure map.
// Does not throw — callers inspect the failure map and record in anchor_status.
export async function fanoutRfc3161(
  sha256HashHex: string,
  targets: readonly Rfc3161TsaTarget[] = DEFAULT_TSAS,
): Promise<{ tokens: Rfc3161Result[]; failures: Record<string, string> }> {
  const results = await Promise.allSettled(targets.map((t) => requestTimestamp(t, sha256HashHex)));
  const tokens: Rfc3161Result[] = [];
  const failures: Record<string, string> = {};
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") tokens.push(r.value);
    else failures[targets[i].name] = r.reason instanceof Error ? r.reason.message : String(r.reason);
  }
  return { tokens, failures };
}

// ---------------------------------------------------------------------------
// Sigstore Rekor — public transparency log submission.
//
// The public instance at rekor.sigstore.dev runs v1 in 2026-04-18. v2 GA is
// mid-2026. We submit a hashedrekord via v1 today; when v2 is deployed to the
// public endpoint, set REKOR_API_VERSION=v2 to switch.
//
// v1 entry shape (propsed entry on POST /api/v1/log/entries):
//   { kind: "hashedrekord", apiVersion: "0.0.1", spec: { signature: {...}, data: {hash:{...}} } }
// ---------------------------------------------------------------------------

export interface RekorResult {
  log_id: string;
  inclusion_proof: unknown;
}

export class RekorEd25519NotSupportedError extends Error {
  constructor() {
    super(
      "Rekor v1 hashedrekord does not support Ed25519 signatures over raw " +
      "messages — its verifier requires a pre-hash. Re-enable when moving to " +
      "Rekor v2 (mid-2026) or switching to an intoto statement entry kind.",
    );
    this.name = "RekorEd25519NotSupportedError";
  }
}

// REKOR_URL allowlist — block trust-laundering attacks via attacker-controlled env var.
const REKOR_URL_ALLOWLIST: ReadonlySet<string> = new Set([
  "rekor.sigstore.dev",
]);

function getValidatedRekorUrl(): string {
  const raw = process.env.REKOR_URL ?? "https://rekor.sigstore.dev";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`REKOR_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`REKOR_URL must use https; got ${url.protocol}`);
  }
  if (!REKOR_URL_ALLOWLIST.has(url.hostname)) {
    throw new Error(`REKOR_URL host ${url.hostname} not on allowlist`);
  }
  return url.origin;
}

// Minimal shape contract for Rekor responses. Unknown fields are ignored safely.
interface RekorV1EntryBody {
  verification?: {
    inclusionProof?: unknown;
  };
}
type RekorV1Response = Record<string, RekorV1EntryBody>;

interface RekorV2Response {
  uuid?: string;
  logIndex?: number;
  verification?: {
    inclusionProof?: unknown;
  };
}

export async function publishToRekor(params: {
  payloadSha256Hex: string;
  signatureB64: string;
  publicKeyPem: string;
  signerAlgorithm: "Ed25519" | "ECDSA" | "RSA";
}): Promise<RekorResult> {
  const REKOR_URL = getValidatedRekorUrl();
  const API_VERSION = process.env.REKOR_API_VERSION ?? "v1";
  const path = API_VERSION === "v2" ? "/api/v2/log/entries" : "/api/v1/log/entries";

  // Rekor v1 hashedrekord requires the signer to have pre-hashed the payload.
  // Ed25519 signs the full message, not a pre-hash, so Rekor's verifier fails
  // for any Ed25519 hashedrekord against v1. Signal "unavailable" upstream
  // until Rekor v2 or an intoto-based submission is wired.
  if (API_VERSION === "v1" && params.signerAlgorithm === "Ed25519") {
    throw new RekorEd25519NotSupportedError();
  }

  const entry = {
    kind: "hashedrekord",
    apiVersion: API_VERSION === "v2" ? "0.0.2" : "0.0.1",
    spec: {
      signature: {
        content: params.signatureB64,
        publicKey: {
          content: Buffer.from(params.publicKeyPem, "utf8").toString("base64"),
        },
      },
      data: {
        hash: {
          algorithm: "sha256",
          value: params.payloadSha256Hex,
        },
      },
    },
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${REKOR_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Rekor HTTP ${res.status}: ${(await res.text()).substring(0, 300)}`);
    }
    const json = await res.json() as unknown;
    let logId: string;
    let inclusionProof: unknown = null;
    if (API_VERSION === "v1") {
      // v1: { <uuid>: { body, verification } }
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        throw new Error("Rekor v1 response: expected object, got " + typeof json);
      }
      const v1 = json as RekorV1Response;
      const uuid = Object.keys(v1)[0];
      if (!uuid) throw new Error("Rekor v1 response missing entry UUID");
      logId = uuid;
      inclusionProof = v1[uuid]?.verification?.inclusionProof ?? null;
    } else {
      if (!json || typeof json !== "object") {
        throw new Error("Rekor v2 response: expected object");
      }
      const v2 = json as RekorV2Response;
      logId = v2.uuid ?? (typeof v2.logIndex === "number" ? v2.logIndex.toString() : "");
      if (!logId) throw new Error("Rekor v2 response missing uuid/logIndex");
      inclusionProof = v2.verification?.inclusionProof ?? null;
    }
    return { log_id: String(logId), inclusion_proof: inclusionProof };
  } finally {
    clearTimeout(timeout);
  }
}

// Backward-compat named export preserved for callers that imported `publishToRekorV2`.
export const publishToRekorV2 = publishToRekor;

// ---------------------------------------------------------------------------
// Cloudflare R2 WORM backup — stub until wrangler auth is configured.
// Phase 0 flagged `wrangler login` as Task D. Stub throws RBackupUnavailable
// and the publisher records "unavailable" in anchor_status.
// ---------------------------------------------------------------------------

export class R2BackupUnavailableError extends Error {
  constructor(detail: string) {
    super(`Cloudflare R2 backup not yet configured: ${detail}`);
    this.name = "R2BackupUnavailableError";
  }
}

export async function backupToR2(_params: {
  epochNumber: number;
  canonicalBytes: Buffer;
  signatureB64: string;
}): Promise<{ r2_key: string }> {
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw new R2BackupUnavailableError("R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY env vars required");
  }
  // TODO: wire with AWS SDK S3Client pointing at R2's S3-compatible API.
  // Intentionally throws for now; see phase-gates/phase-0.md Task D.
  throw new R2BackupUnavailableError("adapter body not yet implemented — env vars set but upload code pending");
}
