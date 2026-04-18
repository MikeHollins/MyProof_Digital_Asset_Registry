// Signer abstraction — lets us swap Ed25519 backends without rewriting the
// epoch publisher. Phase 2 uses FileSigner (PEM from env var, generated locally
// and kept in macOS Keychain for the admin). Phase 5 swaps in KmsSigner when
// AWS credentials become available.
//
// Contract:
//   - sign(message) returns a raw 64-byte Ed25519 signature
//   - publicKeyPem() returns the SPKI PEM of the public key (verifier-facing)
//   - fingerprint() returns a short hex prefix of SHA-256(pubkeyPem) for logs
//
// Both implementations MUST produce signatures that verify against the same
// pubkey regardless of implementation — that is the whole point of the
// interface. The verifier code in policy / epoch endpoints never needs to know
// which backend signed.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  KeyObject,
} from "crypto";

export interface Signer {
  sign(message: Buffer): Promise<Buffer>;
  publicKeyPem(): string;
  fingerprint(): string;
  algorithm(): "Ed25519";
}

// ---------------------------------------------------------------------------
// FileSigner: Phase 2 local Ed25519 signer.
//
// The private key PEM is read from env var EPOCH_SIGNER_PRIVKEY_PEM.
// In local dev, the admin generates a keypair via `openssl genpkey` or
// calls `FileSigner.generate()` to emit a fresh PEM and copies it into the
// env var (via Vercel or `.env.local`).
//
// The pub key PEM is derived from the private key (SPKI format) at construction
// time. No disk I/O.
// ---------------------------------------------------------------------------
export class FileSigner implements Signer {
  private readonly privKey: KeyObject;
  private readonly pubKey: KeyObject;
  private readonly pubKeyPem: string;
  private readonly fp: string;

  constructor(privKeyPem: string) {
    this.privKey = createPrivateKey(privKeyPem);
    if (this.privKey.asymmetricKeyType !== "ed25519") {
      throw new Error(`FileSigner expects Ed25519 private key; got ${this.privKey.asymmetricKeyType}`);
    }
    this.pubKey = createPublicKey(this.privKey);
    this.pubKeyPem = this.pubKey.export({ type: "spki", format: "pem" }).toString();
    this.fp = createHash("sha256").update(this.pubKeyPem).digest("hex").substring(0, 16);
  }

  async sign(message: Buffer): Promise<Buffer> {
    return cryptoSign(null, message, this.privKey);
  }

  publicKeyPem(): string {
    return this.pubKeyPem;
  }

  fingerprint(): string {
    return this.fp;
  }

  algorithm(): "Ed25519" {
    return "Ed25519";
  }

  // Generate a fresh Ed25519 keypair in PEM form. Used by operators to bootstrap
  // a Phase 2 signer before upgrading to KMS. Both PEMs are returned; the
  // private PEM must be stored in a secrets vault and the public PEM published
  // to the transparency page.
  static generate(): { privateKeyPem: string; publicKeyPem: string; fingerprint: string } {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const fp = createHash("sha256").update(pubPem).digest("hex").substring(0, 16);
    return { privateKeyPem: privPem, publicKeyPem: pubPem, fingerprint: fp };
  }
}

// ---------------------------------------------------------------------------
// KmsSigner: Phase 5 AWS KMS-backed signer. Stubbed until AWS credentials are
// configured. The stub throws with a specific, actionable error so callers
// know exactly what's missing.
// ---------------------------------------------------------------------------
export class KmsSignerUnavailableError extends Error {
  constructor(detail: string) {
    super(`AWS KMS signer not yet configured: ${detail}`);
    this.name = "KmsSignerUnavailableError";
  }
}

export class KmsSigner implements Signer {
  constructor(_keyArn: string) {
    throw new KmsSignerUnavailableError(
      "AWS CLI + IAM credentials required — see .agents/phase-gates/phase-0.md Task A/B",
    );
  }
  async sign(_message: Buffer): Promise<Buffer> {
    throw new KmsSignerUnavailableError("unreachable — constructor throws");
  }
  publicKeyPem(): string {
    throw new KmsSignerUnavailableError("unreachable — constructor throws");
  }
  fingerprint(): string {
    throw new KmsSignerUnavailableError("unreachable — constructor throws");
  }
  algorithm(): "Ed25519" {
    return "Ed25519";
  }
}

// Factory: pick a signer based on available env vars.
// EPOCH_SIGNER_MODE=kms  -> KmsSigner (requires AWS_KMS_KEY_ARN)
// EPOCH_SIGNER_MODE=file -> FileSigner (requires EPOCH_SIGNER_PRIVKEY_PEM)
// default (unset)        -> fail-closed (no publishing)
export function createSignerFromEnv(): Signer {
  const mode = process.env.EPOCH_SIGNER_MODE;
  if (mode === "kms") {
    const arn = process.env.AWS_KMS_KEY_ARN;
    if (!arn) throw new Error("EPOCH_SIGNER_MODE=kms but AWS_KMS_KEY_ARN is missing");
    return new KmsSigner(arn);
  }
  if (mode === "file") {
    const pem = process.env.EPOCH_SIGNER_PRIVKEY_PEM;
    if (!pem) throw new Error("EPOCH_SIGNER_MODE=file but EPOCH_SIGNER_PRIVKEY_PEM is missing");
    return new FileSigner(pem);
  }
  throw new Error("EPOCH_SIGNER_MODE must be 'file' or 'kms'. See .agents/phase-gates/phase-0.md for setup.");
}
