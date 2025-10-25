import { sql } from "drizzle-orm";
import { pgTable, text, varchar, bigint, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Proof Assets Table - Privacy-first design (no PII)
export const proofAssets = pgTable("proof_assets", {
  proofAssetId: varchar("proof_asset_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  proofAssetCommitment: text("proof_asset_commitment").notNull(),
  issuerDid: text("issuer_did").notNull(),
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
  bitstring: text("bitstring").notNull(), // Base64-encoded bitstring
  size: bigint("size", { mode: "number" }).notNull(),
  etag: text("etag"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  purposeIdx: index("ix_purpose").on(table.purpose),
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

// TypeScript types
export type ProofAsset = typeof proofAssets.$inferSelect;
export type InsertProofAsset = z.infer<typeof insertProofAssetSchema>;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type StatusList = typeof statusLists.$inferSelect;
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
