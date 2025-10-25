import { db } from "../db";
import { apiKeys, partners } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomBytesHex, shortId, deriveSecretForHash, hashSecret, verifySecret } from "../utils/crypto";

const ID_PREFIX = process.env.APIKEY_ID_PREFIX || "mpk_";
const SECRET_BYTES = Number(process.env.APIKEY_SECRET_BYTES || 32);

export type Scope = 
  | 'assets:mint' 
  | 'assets:read' 
  | 'status:update' 
  | 'transfer:execute' 
  | 'audit:read' 
  | 'admin:*';

export async function issueApiKey(partnerId: string, scopes: Scope[], notAfter?: Date) {
  const secret = randomBytesHex(SECRET_BYTES);
  const keyId = `${ID_PREFIX}${shortId(12)}`;

  const hashed = await hashSecret(deriveSecretForHash(secret));

  await db.insert(apiKeys).values({
    keyId,
    partnerId,
    secretHash: hashed,
    scopes: scopes.join(","),
    status: "active",
    notAfter: notAfter || null,
  });

  const token = `${keyId}.${secret}`;
  return { token, keyId, partnerId, scopes };
}

export async function revokeApiKey(keyId: string) {
  await db.update(apiKeys).set({ status: "revoked" }).where(eq(apiKeys.keyId, keyId));
}

export async function rotateApiKey(keyId: string) {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.keyId, keyId));
  if (!rows.length) throw new Error("key_not_found");
  
  const old = rows[0];
  await revokeApiKey(keyId);
  
  const scopeArray = old.scopes.split(",") as Scope[];
  return issueApiKey(old.partnerId, scopeArray, old.notAfter || undefined);
}

export async function findKey(keyId: string) {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.keyId, keyId));
  return rows[0] || null;
}

export async function validateApiKeyHeader(headerValue?: string) {
  if (!headerValue) return { ok: false, reason: 'missing_header' };
  
  let token = headerValue.trim();
  if (/^ApiKey\s+/i.test(token)) token = token.replace(/^ApiKey\s+/i, "");
  
  const [keyId, secret] = token.split(".");
  if (!keyId || !secret) return { ok: false, reason: 'bad_format' };

  const key = await findKey(keyId);
  if (!key) return { ok: false, reason: 'unknown_key' };
  if (key.status !== "active") return { ok: false, reason: 'key_inactive' };

  const now = new Date();
  if (key.notBefore && now < key.notBefore) return { ok: false, reason: 'not_yet_valid' };
  if (key.notAfter && now > key.notAfter) return { ok: false, reason: 'expired' };

  const pepped = deriveSecretForHash(secret);
  const match = await verifySecret(key.secretHash, pepped);
  if (!match) return { ok: false, reason: 'secret_mismatch' };

  const p = await db.select().from(partners).where(eq(partners.partnerId, key.partnerId));
  if (!p.length || p[0].active === false) return { ok: false, reason: 'partner_inactive' };

  await db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.keyId, keyId));

  const scopes = key.scopes.split(",");
  return { ok: true, partnerId: key.partnerId, keyId, scopes };
}
