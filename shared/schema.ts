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
  ttlSeconds: integer("ttl_seconds"), // Phase 4B: Per-policy TTL (bar=86400, dispensary=604800, bank=7776000)
  expiresAt: timestamp("expires_at", { withTimezone: true }), // Computed: created_at + ttl_seconds
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  commitmentIdx: uniqueIndex("ux_commitment").on(table.proofAssetCommitment),
  proofDigestIdx: uniqueIndex("ux_partner_proof_digest").on(table.partnerId, table.proofDigest),
  statusIdx: index("ix_status").on(table.statusListUrl, table.statusListIndex),
  issuerIdx: index("ix_issuer").on(table.issuerDid),
  partnerIdx: index("ix_partner").on(table.partnerId),
  formatIdx: index("ix_format").on(table.proofFormat),
  verificationStatusIdx: index("ix_verification_status").on(table.verificationStatus),
  // Composite index for partner analytics queries (WHERE partner_id = X AND verification_status = Y)
  partnerStatusIdx: index("ix_partner_verification_status").on(table.partnerId, table.verificationStatus),
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
  webhookUrl: text("webhook_url"), // Phase 4C: URL for revocation/status change notifications
  webhookSecret: text("webhook_secret"), // HMAC secret for webhook signature
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Mint Failures — Dead Letter Queue for failed registry mints
// Phase 3D: Tracks failed async mints for retry and debugging
export const mintFailures = pgTable("mint_failures", {
  failureId: varchar("failure_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  proofDigest: text("proof_digest").notNull(),
  errorMessage: text("error_message").notNull(),
  errorCode: text("error_code"),
  httpStatus: integer("http_status"),
  attempts: integer("attempts").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"), // 'auto_retry' | 'manual' | 'admin'
  mintPayload: jsonb("mint_payload").notNull(), // Full mint request for replay
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sessionIdx: index("ix_mint_fail_session").on(table.sessionId),
  resolvedIdx: index("ix_mint_fail_resolved").on(table.resolved),
  tenantIdx: index("ix_mint_fail_tenant").on(table.tenantId),
}));

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

// Policies - First-class policy registry with 24h delay-lock governance
// Every proof asset references a policy by policy_cid. Policies are versioned with a
// hash chain (previous_version_hash) and require an admin signature plus a 24-hour
// effective delay before they activate.
export const policies = pgTable("policies", {
  policyId: uuid("policy_id").primaryKey().defaultRandom(),
  policyCid: text("policy_cid").notNull().unique(), // Content-addressed canonical identifier
  name: text("name").notNull(), // Human-readable: bar_us_21, adult_fr, bank_us_18_kyc
  version: text("version").notNull(), // Semver, e.g. 1.0.0
  previousVersionHash: text("previous_version_hash"), // Hash chain; null for genesis
  rules: jsonb("rules").notNull(), // Serialized rule list per circuit schema
  minTrustLevel: text("min_trust_level").notNull(), // CRYPTO_STRONG | PASSIVE_AUTH_HASH_ONLY | AUTH_SIGNALS_DL | AUTH_SIGNALS
  ttlSeconds: integer("ttl_seconds").notNull(), // Per-policy proof lifetime
  jurisdiction: text("jurisdiction").notNull(), // ISO format: US-TX, US-CA, FR, EU, etc.
  plainLanguage: text("plain_language").notNull(), // Regulator-readable description
  approvalSignature: text("approval_signature"), // Admin signature over canonical policy bytes
  approvalSignedAt: timestamp("approval_signed_at", { withTimezone: true }),
  effectiveAt: timestamp("effective_at", { withTimezone: true }), // 24h delay-lock; null until signed
  deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  cidIdx: uniqueIndex("ux_policy_cid").on(table.policyCid),
  nameVersionIdx: uniqueIndex("ux_policy_name_version").on(table.name, table.version),
  nameIdx: index("ix_policy_name").on(table.name),
  jurisdictionIdx: index("ix_policy_jurisdiction").on(table.jurisdiction),
  effectiveIdx: index("ix_policy_effective").on(table.effectiveAt),
}));

// Circuit Versions - Registry of all circuit versions ever deployed
// A proof asset's verification key must be looked up by circuit_version to support
// verifying historical proofs after a circuit upgrade. Old circuits never disappear;
// they only get marked deprecated_at when retired from NEW proofs. Existing proofs
// from a deprecated circuit remain verifiable via this registry forever.
export const circuitVersions = pgTable("circuit_versions", {
  circuitVersion: text("circuit_version").primaryKey(), // v1, v2, etc.
  circuitCid: text("circuit_cid").notNull(), // IPFS CID of circuit bytecode
  description: text("description").notNull(),
  verificationKey: text("verification_key").notNull(), // Serialized verification key
  cycleCount: integer("cycle_count").notNull(), // RISC Zero cycles for this circuit
  journalFormat: jsonb("journal_format").notNull(), // Describes journal fields (4 u32s: is_valid, circuit_version, doc_commitment, constraint_type)
  frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
  deprecatedAt: timestamp("deprecated_at", { withTimezone: true }), // Null = still active for NEW proofs
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  cidIdx: uniqueIndex("ux_circuit_cid").on(table.circuitCid),
  deprecatedIdx: index("ix_circuit_deprecated").on(table.deprecatedAt),
}));

// Epoch Roots — hourly signed Merkle tree heads over audit events.
// Phase 2: each row represents one epoch's transparency-log root, signed by
// an Ed25519 key (Phase 2 = FileSigner, Phase 5+ = AWS KMS), anchored to
// multiple external tamper-evidence systems (Sigstore TSA, FreeTSA, Rekor v2,
// Cloudflare R2 WORM backup). Old epochs never mutate. New epochs chain via
// previous_epoch_hash to enable a consistency proof walk.
export const epochRoots = pgTable("epoch_roots", {
  epochId: varchar("epoch_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  epochNumber: bigint("epoch_number", { mode: "number" }).notNull(), // Monotonic sequence, starts at 1
  merkleRoot: text("merkle_root").notNull(), // Hex SHA-256 over all leaves using RFC 6962 domain tags
  treeSize: integer("tree_size").notNull(), // Number of audit events included at this root
  previousEpochHash: text("previous_epoch_hash"), // Hex SHA-256 of previous epoch_number+merkle_root+timestamp; null for epoch 1
  signerFingerprint: text("signer_fingerprint").notNull(), // SHA-256 prefix of signing pubkey (PEM)
  signerAlgorithm: text("signer_algorithm").notNull().default("Ed25519"), // Upgrade path: ML-DSA-65 co-sign
  signatureEd25519: text("signature_ed25519").notNull(), // Base64url Ed25519 signature over canonical epoch bytes
  signatureMlDsa: text("signature_ml_dsa"), // Phase 5+ PQ co-signature slot; null in Phase 2
  rfc3161Tokens: jsonb("rfc_3161_tokens").notNull(), // Array of {tsa_url, token_b64, issued_at} from each TSA
  rekorLogId: text("rekor_log_id"), // Rekor v2 log entry ID once anchored
  rekorInclusionProof: jsonb("rekor_inclusion_proof"), // Fetched from Rekor post-submission
  r2BackupKey: text("r2_backup_key"), // Cloudflare R2 object key once backed up; null until Cloudflare auth active
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  // Anchors are optional individually but every epoch must have at least one.
  // Publisher logs which anchors succeeded/failed in anchor_status for observability.
  anchorStatus: jsonb("anchor_status").notNull(), // e.g. { sigstore_tsa: "ok", freetsa: "ok", rekor_v2: "ok", r2_backup: "unavailable" }
}, (table) => ({
  numberIdx: uniqueIndex("ux_epoch_number").on(table.epochNumber),
  // NOTE: merkle_root is NOT unique — consecutive epochs with no new audit
  // events legitimately share the empty-tree root hash. epoch_number is the
  // authoritative unique identifier.
  rootIdx: index("ix_epoch_root").on(table.merkleRoot),
  publishedIdx: index("ix_epoch_published").on(table.publishedAt),
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

// Trust-level enum — shared with iOS client, must stay in sync with
// mobile-app/AgeProofClip/TrustTypes.swift:15-37
export const trustLevelEnum = z.enum([
  'CRYPTO_STRONG',           // Passport NFC: sig valid + hashes matched + CSCA chain trusted
  'PASSIVE_AUTH_HASH_ONLY',  // Passport NFC: hashes matched, chain not verified
  'AUTH_SIGNALS_DL',         // Optical DL via PDF417 (always this tier until mDL ships)
  'AUTH_SIGNALS',            // Passport MRZ fallback, no chip
]);

// Rule types — mirrors constraint_type bitmask in
// mobile-app/AgeProofClip/ContentView.swift:1532-1612
export const ruleTypeEnum = z.enum([
  'AGE_OVER',
  'EXPIRY_OK',
  'NATIONALITY_IN',
  'STATE_IN',
  'STATE_NOT_IN',
  'DOC_TYPE_IN',
  'NATIONALITY_NOT_IN',
  'AGE_BETWEEN',
]);

// Policy rule — one entry in the policies.rules jsonb array
export const policyRuleSchema = z.object({
  rule_type: ruleTypeEnum,
  params: z.array(z.number().int()).optional(),      // e.g., [21] for AGE_OVER
  list_params: z.array(z.number().int()).optional(), // e.g., state codes for STATE_IN
  list_count: z.number().int().min(0).optional(),
});

export const insertPolicySchema = createInsertSchema(policies, {
  policyCid: z.string().min(10).max(200),
  name: z.string().regex(/^[a-z][a-z0-9_]*$/), // snake_case only
  version: z.string().regex(/^\d+\.\d+\.\d+$/), // semver
  rules: z.array(policyRuleSchema).min(1),
  minTrustLevel: trustLevelEnum,
  ttlSeconds: z.number().int().min(60).max(31_536_000), // 1 min to 1 year
  jurisdiction: z.string().min(2).max(10), // ISO-like: US-TX, FR, EU
  plainLanguage: z.string().min(10).max(500),
}).omit({
  policyId: true,
  previousVersionHash: true,
  approvalSignature: true,
  approvalSignedAt: true,
  effectiveAt: true,
  deprecatedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCircuitVersionSchema = createInsertSchema(circuitVersions, {
  circuitVersion: z.string().regex(/^v\d+$/), // v1, v2, ...
  circuitCid: z.string().min(10).max(200),
  description: z.string().min(10).max(500),
  verificationKey: z.string().min(1),
  cycleCount: z.number().int().min(1),
  journalFormat: z.record(z.any()),
}).omit({
  deprecatedAt: true,
  createdAt: true,
});

// Epoch root zod — used by the hourly cron + transparency endpoints
export const rfc3161TokenSchema = z.object({
  tsa_url: z.string().url(),
  token_b64: z.string().min(1),
  issued_at: z.string(), // ISO 8601
});

export const insertEpochRootSchema = createInsertSchema(epochRoots, {
  epochNumber: z.number().int().min(1),
  merkleRoot: z.string().regex(/^[0-9a-f]{64}$/),
  treeSize: z.number().int().min(0),
  signerFingerprint: z.string().min(8).max(128),
  signatureEd25519: z.string().min(1),
  rfc3161Tokens: z.array(rfc3161TokenSchema),
  anchorStatus: z.record(z.enum(["ok", "failed", "unavailable"])),
}).omit({
  epochId: true,
  publishedAt: true,
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
export type Policy = typeof policies.$inferSelect;
export type InsertPolicy = z.infer<typeof insertPolicySchema>;
export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type TrustLevel = z.infer<typeof trustLevelEnum>;
export type RuleType = z.infer<typeof ruleTypeEnum>;
export type CircuitVersion = typeof circuitVersions.$inferSelect;
export type InsertCircuitVersion = z.infer<typeof insertCircuitVersionSchema>;
export type EpochRoot = typeof epochRoots.$inferSelect;
export type InsertEpochRoot = z.infer<typeof insertEpochRootSchema>;
export type Rfc3161Token = z.infer<typeof rfc3161TokenSchema>;

// Additional interfaces for frontend
export interface DashboardStats {
  totalProofs: number;
  verifiedToday: number;
  activeStatusLists: number;
  pendingVerifications: number;
  failedMintCount: number;
  expiringSoon: number;
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

export type MintFailure = typeof mintFailures.$inferSelect;

