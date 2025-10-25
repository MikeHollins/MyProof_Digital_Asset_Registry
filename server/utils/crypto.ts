import crypto from "node:crypto";
import argon2 from "argon2";

const PEPPER = process.env.APIKEY_PEPPER || "dev-pepper-change-in-production";
if (!PEPPER && process.env.NODE_ENV === "production") {
  throw new Error("APIKEY_PEPPER is required in production");
}

export function randomBytesHex(n = 32): string {
  return crypto.randomBytes(n).toString("hex");
}

export function shortId(len = 10): string {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

export function deriveSecretForHash(secret: string): Buffer {
  return crypto.createHmac("sha256", PEPPER).update(secret, "utf8").digest();
}

export async function hashSecret(pepped: Buffer): Promise<string> {
  return argon2.hash(pepped, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifySecret(hash: string, pepped: Buffer): Promise<boolean> {
  try {
    return await argon2.verify(hash, pepped);
  } catch {
    return false;
  }
}
