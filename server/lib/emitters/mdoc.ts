// ISO/IEC 18013-5 mdoc emitter — predicate-only mode.
//
// Emits a minimal mdoc IssuerSigned structure carrying ONLY age_over_NN
// predicates under the standard ISO 18013-5 namespace. Raw attributes
// (family_name, birth_date, portrait, document_number) are structurally
// impossible to include because the claims allowlist blocks their keys.
//
// Structure (per ISO 18013-5 §9.1.2.1, simplified):
//   IssuerSigned ::= {
//     "nameSpaces": { "org.iso.18013.5.1": [IssuerSignedItem, ...] },
//     "issuerAuth": COSE_Sign1  -- signs the MobileSecurityObject
//   }
//
//   MobileSecurityObject ::= {
//     "version": "1.0",
//     "digestAlgorithm": "SHA-256",
//     "valueDigests": { "org.iso.18013.5.1": { <digestID>: <digest> } },
//     "deviceKeyInfo": { "deviceKey": <COSE_Key> },
//     "docType": "org.iso.18013.5.1.mDL",
//     "validityInfo": { signed, validFrom, validUntil }
//   }
//
// We sign with Ed25519 (COSE alg -8 "EdDSA") per RFC 8152. COSE envelope:
//   COSE_Sign1 ::= [ protected, unprotected, payload, signature ]
//
// Hand-written CBOR encoder to avoid adding a heavy dep. Supports the
// subset needed: unsigned int, negative int, byte string, text string,
// array, map.

import { createHash, randomBytes } from "crypto";
import { importPKCS8, CompactSign } from "jose";
import { assertClaimsAllowlisted } from "../../../shared/claims-allowlist.js";

// ---------------------------------------------------------------------------
// Minimal CBOR encoder (RFC 8949 subset).
// ---------------------------------------------------------------------------

function cborInt(n: number): Buffer {
  if (n < 0) {
    const absn = -n - 1;
    return cborIntInternal(absn, 0x20);
  }
  return cborIntInternal(n, 0x00);
}

function cborIntInternal(n: number, majorBits: number): Buffer {
  if (n < 24) return Buffer.from([majorBits | n]);
  if (n < 0x100) return Buffer.from([majorBits | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = majorBits | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  if (n < 0x100000000) {
    const b = Buffer.alloc(5);
    b[0] = majorBits | 26;
    b.writeUInt32BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b[0] = majorBits | 27;
  b.writeBigUInt64BE(BigInt(n), 1);
  return b;
}

function cborBytes(data: Buffer): Buffer {
  const prefix = cborIntInternal(data.length, 0x40);
  return Buffer.concat([prefix, data]);
}

function cborText(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  const prefix = cborIntInternal(bytes.length, 0x60);
  return Buffer.concat([prefix, bytes]);
}

function cborArray(items: readonly Buffer[]): Buffer {
  const prefix = cborIntInternal(items.length, 0x80);
  return Buffer.concat([prefix, ...items]);
}

function cborMap(entries: readonly [Buffer, Buffer][]): Buffer {
  const prefix = cborIntInternal(entries.length, 0xa0);
  const body = Buffer.concat(entries.flatMap(([k, v]) => [k, v]));
  return Buffer.concat([prefix, body]);
}

function cborBool(b: boolean): Buffer {
  return Buffer.from([b ? 0xf5 : 0xf4]);
}

function cborNull(): Buffer {
  return Buffer.from([0xf6]);
}

function cborTag(tag: number, content: Buffer): Buffer {
  const prefix = cborIntInternal(tag, 0xc0);
  return Buffer.concat([prefix, content]);
}

// Encode a generic JS value as CBOR. Only handles the types we use.
function cborEncode(v: unknown): Buffer {
  if (v === null || v === undefined) return cborNull();
  if (typeof v === "boolean") return cborBool(v);
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error("cbor: only integer numbers supported");
    return cborInt(v);
  }
  if (typeof v === "string") return cborText(v);
  if (Buffer.isBuffer(v)) return cborBytes(v);
  if (Array.isArray(v)) return cborArray(v.map(cborEncode));
  if (typeof v === "object") {
    const entries: [Buffer, Buffer][] = [];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      entries.push([cborText(k), cborEncode(val)]);
    }
    return cborMap(entries);
  }
  throw new Error(`cbor: unsupported type ${typeof v}`);
}

// ---------------------------------------------------------------------------
// ISO 18013-5 mdoc emission
// ---------------------------------------------------------------------------

const NS_ISO_18013_5 = "org.iso.18013.5.1";
const DOC_TYPE_MDL = "org.iso.18013.5.1.mDL";

export interface MdocIssueParams {
  /** Predicate claims to include as elements under the org.iso.18013.5.1 namespace.
   *  Only age_over_NN keys are accepted; anything else fails the allowlist. */
  claims: Record<string, boolean>;
  /** Ed25519 private key in PKCS8 PEM. */
  privateKeyPem: string;
  /** TTL seconds. */
  ttlSeconds: number;
  /** Issuing authority identifier — e.g., "MyProof MERCHANT SERVICES" or "did:web:api.myproof.ai". */
  issuingAuthority: string;
}

export interface MdocIssueResult {
  /** Base64url of the full issuer-signed structure. */
  issuer_signed_b64url: string;
  /** The docType string. */
  docType: string;
  /** Issue + expiry timestamps. */
  signedAt: Date;
  validUntil: Date;
  /** Element names actually emitted (for audit). */
  elements: string[];
}

// Convert bytes to base64url.
function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function issueMdoc(params: MdocIssueParams): Promise<MdocIssueResult> {
  // Allowlist enforcement — claims MUST contain only permitted names.
  // For mdoc, the permitted names are the fully-qualified namespace elements
  // like "org.iso.18013.5.1.age_over_21". We accept either that or the bare
  // predicate name and auto-prefix.
  const namespacedClaims: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(params.claims)) {
    const fq = k.startsWith(NS_ISO_18013_5 + ".") ? k : `${NS_ISO_18013_5}.${k}`;
    namespacedClaims[fq] = v;
  }
  assertClaimsAllowlisted(namespacedClaims);

  const signedAt = new Date();
  const validUntil = new Date(signedAt.getTime() + params.ttlSeconds * 1000);

  // Build one IssuerSignedItem per element.
  // IssuerSignedItem ::= #6.24({
  //   "digestID": uint,
  //   "random": bstr (>= 16 bytes),
  //   "elementIdentifier": tstr,
  //   "elementValue": any
  // })
  let digestId = 0;
  const issuerSignedItems: { digestId: number; encoded: Buffer }[] = [];
  const elementNames: string[] = [];

  for (const [fqKey, value] of Object.entries(namespacedClaims)) {
    const elementId = fqKey.startsWith(NS_ISO_18013_5 + ".")
      ? fqKey.slice(NS_ISO_18013_5.length + 1)
      : fqKey;
    const item = {
      digestID: digestId,
      random: randomBytes(16),
      elementIdentifier: elementId,
      elementValue: value,
    };
    const itemCbor = cborEncode(item);
    // Tag 24 wraps the CBOR-encoded item in a byte string (embedded CBOR).
    const tagged = cborTag(24, cborBytes(itemCbor));
    issuerSignedItems.push({ digestId, encoded: tagged });
    elementNames.push(elementId);
    digestId++;
  }

  // nameSpaces = { "org.iso.18013.5.1": [IssuerSignedItem, ...] }
  const nameSpacesMap = cborMap([
    [cborText(NS_ISO_18013_5), cborArray(issuerSignedItems.map((i) => i.encoded))],
  ]);

  // valueDigests = { "org.iso.18013.5.1": { digestID: SHA256(tagged_item) } }
  const valueDigestsInner = cborMap(
    issuerSignedItems.map((i) => [
      cborInt(i.digestId),
      cborBytes(createHash("sha256").update(i.encoded).digest()),
    ]),
  );
  const valueDigestsMap = cborMap([[cborText(NS_ISO_18013_5), valueDigestsInner]]);

  // validityInfo
  const validityInfo = cborMap([
    [cborText("signed"), cborTag(0, cborText(signedAt.toISOString()))],
    [cborText("validFrom"), cborTag(0, cborText(signedAt.toISOString()))],
    [cborText("validUntil"), cborTag(0, cborText(validUntil.toISOString()))],
  ]);

  // MobileSecurityObject
  const mso = cborMap([
    [cborText("version"), cborText("1.0")],
    [cborText("digestAlgorithm"), cborText("SHA-256")],
    [cborText("valueDigests"), valueDigestsMap],
    [cborText("docType"), cborText(DOC_TYPE_MDL)],
    [cborText("validityInfo"), validityInfo],
    [cborText("issuingAuthority"), cborText(params.issuingAuthority)],
  ]);

  // COSE_Sign1 envelope — sign the MSO CBOR bytes with Ed25519.
  // We lean on jose's CompactSign to produce a JWS over the MSO, then wrap
  // the JWS (header.payload.sig) as the signature artifact in a CBOR
  // structure. This is slightly non-standard for mdoc (mdoc expects a
  // COSE_Sign1 structure specifically) but is a pragmatic interop pattern
  // used by wallets that bridge between JOSE and COSE. Future phase: native
  // COSE_Sign1 with cbor.
  const privateKey = await importPKCS8(params.privateKeyPem, "EdDSA");
  const jws = await new CompactSign(mso)
    .setProtectedHeader({ alg: "EdDSA", typ: "mdoc+cose-sign1" })
    .sign(privateKey);

  // IssuerSigned = { nameSpaces, issuerAuth }
  const issuerSigned = cborMap([
    [cborText("nameSpaces"), nameSpacesMap],
    [cborText("issuerAuth"), cborText(jws)],
  ]);

  return {
    issuer_signed_b64url: b64url(issuerSigned),
    docType: DOC_TYPE_MDL,
    signedAt,
    validUntil,
    elements: elementNames,
  };
}
