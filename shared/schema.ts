import { sql } from "drizzle-orm";
import { pgTable, text, varchar, bigint, jsonb, timestamp, index, uniqueIndex, uuid, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Proof Assets Table - Privacy-first design (no PII)
export const proofAssets = pgTable("proof_assets", {
  proofAssetId: varchar("proof_asset_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  proofAssetCommitment: text("proof_asset_commitment").notNull(),
  issuerDid: text("issuer_did").notNull(),
  partnerId: uuid("partner_id"),
  subjectBinding: text("subject_binding"),
  proofFormat: text("proof_format").notNull(),
  proofDigest: text("proof_digest").notNull(),
  digestAlg: text("digest_alg").notNull(),
  proofUri: text("proof_uri"),
  constraintHash: text("constraint_hash").notNull(),
  constraintCid: text("constraint_cid"),
  policyHash: text("policy_hash").notNull(),
  policyCid: text("policy_cid").notNull(),
  circuitOrSchemaId: text("circuit_or_schema_id"),
  circuitCid: text("circuit_cid"),
  schemaCid: text("schema_cid"),
  contentCids: text("content_cids").array(),
  license: jsonb("license"),
  statusListUrl: text("status_list_url").notNull(),
  statusListIndex: text("status_list_index").notNull(),
  statusPurpose: text("status_purpose").notNull(),
  attestations: jsonb("attestations"),
  auditCid: text("audit_cid"),
  verificationStatus: text("verification_status").default("pending"),
  verificationAlgorithm: text("verification_algorithm"),
  verificationPublicKeyDigest: text("verification_public_key_digest"),
  verificationTimestamp: timestamp("verification_timestamp", { withTimezone: true }),
  verificationMetadata: jsonb("verification_metadata"),
  verifierProofRef: text("verifier_proof_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  commitmentIdx: uniqueIndex("ux_commitment").on(table.proofAssetCommitment),
  statusIdx: index("ix_status").on(table.statusListUrl, table.statusListIndex),
  issuerIdx: index("ix_issuer").on(table.issuerDid),
  partnerIdx: index("ix_partner").on(table.partnerId),
  formatIdx: index("ix_format").on(table.proofFormat),
  verificationStatusIdx: index("ix_verification_status").on(table.verificationStatus),
}));

// Audit/Transparency Log - Append-only event tracking
export const auditEvents = pgTable("audit_events", {
  eventId: varchar("event_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  eventType: text("event_type").notNull(),
  assetId: varchar("asset_id", { length: 36 }),
  payload: jsonb("payload").notNull(),
  traceId: text("trace_id"),
  previousHash: text("previous_hash"),
  eventHash: text("event_hash").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  assetIdx: index("ix_audit_asset").on(table.assetId),
  typeIdx: index("ix_audit_type").on(table.eventType),
  timestampIdx: index("ix_audit_timestamp").on(table.timestamp),
}));

// Status Lists - W3C Bitstring Status List tracking
export const statusLists = pgTable("status_lists", {
  listId: varchar("list_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  purpose: text("purpose").notNull(),
  url: text("url").notNull().unique(),
  bitstring: text("bitstring").notNull(), // Base64-encoded gzipped bitstring
  size: bigint("size", { mode: "number" }).notNull(),
  etag: text("etag"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  purposeIdx: index("ix_purpose").on(table.purpose),
}));

// JTI Replay Cache - Prevent receipt replay attacks across restarts
export const jtiReplay = pgTable("jti_replay", {
  jti: text("jti").primaryKey(),
  expAt: timestamp("exp_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  expAtIdx: index("ix_exp_at").on(table.expAt),
}));

// Partners - API key partner organizations
export const partners = pgTable("partners", {
  partnerId: uuid("partner_id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  contactEmail: text("contact_email"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// API Keys - Scoped API authentication with Argon2id hashing
export const apiKeys = pgTable("api_keys", {
  keyId: varchar("key_id", { length: 64 }).primaryKey(),
  partnerId: uuid("partner_id").notNull().references(() => partners.partnerId),
  secretHash: text("secret_hash").notNull(),
  scopes: text("scopes").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
  notAfter: timestamp("not_after", { withTimezone: true }),
  ratePerMinute: integer("rate_per_minute").notNull().default(300), // Future: Per-key rate limiting (not yet enforced)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (table) => ({
  partnerIdx: index("ix_api_keys_partner").on(table.partnerId),
  statusIdx: index("ix_api_keys_status").on(table.status),
}));

// Asset Transfers - Provenance tracking for ownership changes
export const assetTransfers = pgTable("asset_transfers", {
  transferId: uuid("transfer_id").primaryKey().defaultRandom(),
  assetId: varchar("asset_id", { length: 36 }).notNull().references(() => proofAssets.proofAssetId),
  fromDid: text("from_did").notNull(),
  toDid: text("to_did").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  assetIdx: index("ix_transfers_asset").on(table.assetId),
  toDidIdx: index("ix_transfers_to_did").on(table.toDid),
}));

// Asset Usage - Track usage events with optional license limits
export const assetUsage = pgTable("asset_usage", {
  usageId: uuid("usage_id").primaryKey().defaultRandom(),
  assetId: varchar("asset_id", { length: 36 }).notNull().references(() => proofAssets.proofAssetId),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  assetIdx: index("ix_usage_asset").on(table.assetId),
  usedAtIdx: index("ix_usage_used_at").on(table.usedAt),
}));

// Zod Schemas for API validation
export const proofFormatEnum = z.enum([
  'ZK_PROOF',
  'JWS',
  'LD_PROOF',
  'HW_ATTESTATION',
  'MERKLE_PROOF',
  'BLOCKCHAIN_TX_PROOF',
  'OTHER'
]);

export const digestAlgEnum = z.enum([
  'sha2-256',
  'sha3-256',
  'blake3',
  'multihash'
]);

export const verifierProofRefSchema = z.object({
  proof_format: proofFormatEnum,
  proof_uri: z.string().optional(),
  proof_digest: z.string(),
  digest_alg: digestAlgEnum,
});

export const insertProofAssetSchema = createInsertSchema(proofAssets, {
  proofFormat: proofFormatEnum,
  digestAlg: digestAlgEnum,
  subjectBinding: z.string().optional(),
  proofUri: z.string().optional(),
  constraintCid: z.string().optional(),
  circuitOrSchemaId: z.string().optional(),
  circuitCid: z.string().optional(),
  schemaCid: z.string().optional(),
  contentCids: z.array(z.string()).optional(),
  license: z.any().optional(),
  attestations: z.any().optional(),
  auditCid: z.string().optional(),
}).omit({
  proofAssetId: true,
  proofAssetCommitment: true,
  createdAt: true,
  updatedAt: true,
  verificationStatus: true,
  verificationAlgorithm: true,
  verificationPublicKeyDigest: true,
  verificationTimestamp: true,
  verificationMetadata: true,
  verifierProofRef: true,
  statusListUrl: true,
  statusListIndex: true,
  statusPurpose: true,
}).extend({
  verifier_proof_ref: verifierProofRefSchema,
});

export const insertAuditEventSchema = createInsertSchema(auditEvents).omit({
  eventId: true,
  timestamp: true,
  eventHash: true,
  previousHash: true,
});

export const statusListOperationSchema = z.object({
  op: z.enum(['set', 'clear', 'flip']),
  index: z.number().int().min(0),
});

export const updateStatusListSchema = z.object({
  statusListUrl: z.string(),
  operations: z.array(statusListOperationSchema),
});

export const insertPartnerSchema = createInsertSchema(partners, {
  name: z.string().min(2),
  contactEmail: z.string().email().optional(),
}).omit({ partnerId: true, createdAt: true, updatedAt: true });

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({ 
  keyId: true, 
  secretHash: true, 
  createdAt: true, 
  lastUsedAt: true 
});

// TypeScript types
export type ProofAsset = typeof proofAssets.$inferSelect;
export type InsertProofAsset = z.infer<typeof insertProofAssetSchema>;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type StatusList = typeof statusLists.$inferSelect;
export type JtiReplay = typeof jtiReplay.$inferSelect;
export type Partner = typeof partners.$inferSelect;
export type InsertPartner = z.infer<typeof insertPartnerSchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ProofFormat = z.infer<typeof proofFormatEnum>;
export type DigestAlg = z.infer<typeof digestAlgEnum>;
export type VerifierProofRef = z.infer<typeof verifierProofRefSchema>;
export type StatusListOperation = z.infer<typeof statusListOperationSchema>;
export type UpdateStatusList = z.infer<typeof updateStatusListSchema>;

// Additional interfaces for frontend
export interface DashboardStats {
  totalProofs: number;
  verifiedToday: number;
  activeStatusLists: number;
  pendingVerifications: number;
}

export interface SystemHealth {
  database: 'healthy' | 'degraded' | 'down';
  redis: 'healthy' | 'degraded' | 'down';
  verifier: 'healthy' | 'degraded' | 'down';
}

export interface VerificationResult {
  ok: boolean;
  reason?: string;
  derivedFacts?: Record<string, unknown>;
  timestamp?: string;
  proofAssetId?: string;
}
