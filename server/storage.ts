import {
  type ProofAsset,
  type InsertProofAsset,
  type AuditEvent,
  type InsertAuditEvent,
  type StatusList,
  type DashboardStats,
  type SystemHealth,
} from "../shared/schema.js";

export interface IStorage {
  // Proof Assets
  getProofAsset(id: string): Promise<ProofAsset | undefined>;
  getProofAssets(): Promise<ProofAsset[]>;
  getRecentProofAssets(limit?: number): Promise<ProofAsset[]>;
  getProofAssetCountByStatusList(statusListUrl: string): Promise<number>;
  getProofAssetByDigest(partnerId: string | null, proofDigest: string): Promise<ProofAsset | undefined>;
  createProofAsset(proof: Partial<ProofAsset>): Promise<ProofAsset>;
  updateProofAsset(id: string, updates: Partial<ProofAsset>): Promise<ProofAsset>;
  updateProofAssetStatus(id: string, status: string): Promise<void>;

  // Audit Events
  getAuditEvents(): Promise<AuditEvent[]>;
  createAuditEvent(event: Partial<AuditEvent>): Promise<AuditEvent>;

  // Status Lists
  getStatusLists(): Promise<StatusList[]>;
  getStatusList(url: string): Promise<StatusList | undefined>;
  createStatusList(list: Partial<StatusList>): Promise<StatusList>;
  updateStatusList(url: string, bitstring: string, etag: string): Promise<void>;

  // Stats
  getDashboardStats(): Promise<DashboardStats>;
  getSystemHealth(): Promise<SystemHealth>;

  // Dead Letter Queue — Failed Mints
  recordMintFailure(failure: { sessionId: string; tenantId: string; proofDigest: string; errorMessage: string; errorCode?: string; httpStatus?: number; attempts: number; mintPayload: any }): Promise<void>;
  getUnresolvedMintFailures(limit?: number): Promise<any[]>;
  resolveMintFailure(failureId: string, resolvedBy: string): Promise<void>;

  // Partners
  listPartners(): Promise<any[]>;
  createPartner(partner: { name: string; contactEmail?: string | null; webhookUrl?: string | null; webhookSecret?: string | null }): Promise<any>;
}

export class MemStorage implements IStorage {
  private proofAssets: Map<string, ProofAsset>;
  private auditEvents: AuditEvent[];
  private statusLists: Map<string, StatusList>;

  constructor() {
    this.proofAssets = new Map();
    this.auditEvents = [];
    this.statusLists = new Map();
  }

  async getProofAsset(id: string): Promise<ProofAsset | undefined> {
    return this.proofAssets.get(id);
  }

  async getProofAssets(): Promise<ProofAsset[]> {
    return Array.from(this.proofAssets.values());
  }

  async getRecentProofAssets(limit: number = 10): Promise<ProofAsset[]> {
    return Array.from(this.proofAssets.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async getProofAssetCountByStatusList(statusListUrl: string): Promise<number> {
    return Array.from(this.proofAssets.values())
      .filter(p => p.statusListUrl === statusListUrl).length;
  }

  async getProofAssetByDigest(partnerId: string | null, proofDigest: string): Promise<ProofAsset | undefined> {
    return Array.from(this.proofAssets.values())
      .find(p => p.partnerId === partnerId && p.proofDigest === proofDigest);
  }

  async createProofAsset(proof: Partial<ProofAsset>): Promise<ProofAsset> {
    const id = crypto.randomUUID();
    const now = new Date();
    const asset: ProofAsset = {
      proofAssetId: id,
      proofAssetCommitment: proof.proofAssetCommitment || "",
      issuerDid: proof.issuerDid || "",
      partnerId: proof.partnerId || null,
      subjectBinding: proof.subjectBinding || null,
      proofFormat: proof.proofFormat || "",
      proofDigest: proof.proofDigest || "",
      digestAlg: proof.digestAlg || "",
      proofUri: proof.proofUri || null,
      constraintHash: proof.constraintHash || "",
      constraintCid: proof.constraintCid || null,
      policyHash: proof.policyHash || "",
      policyCid: proof.policyCid || "",
      circuitOrSchemaId: proof.circuitOrSchemaId || null,
      circuitCid: proof.circuitCid || null,
      schemaCid: proof.schemaCid || null,
      contentCids: proof.contentCids || null,
      license: proof.license || null,
      statusListUrl: proof.statusListUrl || "",
      statusListIndex: proof.statusListIndex || "",
      statusPurpose: proof.statusPurpose || "",
      attestations: proof.attestations || null,
      auditCid: proof.auditCid || null,
      verificationStatus: proof.verificationStatus || "pending",
      verificationAlgorithm: proof.verificationAlgorithm || null,
      verificationPublicKeyDigest: proof.verificationPublicKeyDigest || null,
      verificationTimestamp: proof.verificationTimestamp || null,
      verificationMetadata: proof.verificationMetadata || null,
      verifierProofRef: proof.verifierProofRef || null,
      ttlSeconds: proof.ttlSeconds || null,
      expiresAt: proof.expiresAt || null,
      createdAt: now,
      updatedAt: now,
    };
    this.proofAssets.set(id, asset);
    return asset;
  }

  async updateProofAsset(id: string, updates: Partial<ProofAsset>): Promise<ProofAsset> {
    const asset = this.proofAssets.get(id);
    if (!asset) {
      throw new Error(`Proof asset ${id} not found`);
    }
    const updated: ProofAsset = {
      ...asset,
      ...updates,
      updatedAt: new Date(),
    };
    this.proofAssets.set(id, updated);
    return updated;
  }

  async updateProofAssetStatus(id: string, status: string): Promise<void> {
    const asset = this.proofAssets.get(id);
    if (asset) {
      asset.verificationStatus = status;
      asset.updatedAt = new Date();
    }
  }

  async getAuditEvents(): Promise<AuditEvent[]> {
    return [...this.auditEvents].reverse();
  }

  async createAuditEvent(event: Partial<AuditEvent>): Promise<AuditEvent> {
    const id = crypto.randomUUID();
    const previousHash = this.auditEvents.length > 0
      ? this.auditEvents[this.auditEvents.length - 1].eventHash
      : null;

    const auditEvent: AuditEvent = {
      eventId: id,
      eventType: event.eventType || "MINT",
      assetId: event.assetId || null,
      payload: event.payload || {},
      traceId: event.traceId || null,
      previousHash,
      eventHash: crypto.randomUUID(), // Simplified hash for demo
      timestamp: new Date(),
    };
    this.auditEvents.push(auditEvent);
    return auditEvent;
  }

  async getStatusLists(): Promise<StatusList[]> {
    return Array.from(this.statusLists.values());
  }

  async getStatusList(url: string): Promise<StatusList | undefined> {
    return this.statusLists.get(url);
  }

  async createStatusList(list: Partial<StatusList>): Promise<StatusList> {
    const id = crypto.randomUUID();
    const now = new Date();
    // Create default bitstring (base64-encoded empty buffer)
    const defaultBitstring = Buffer.alloc(16384).toString('base64');
    const statusList: StatusList = {
      listId: id,
      purpose: list.purpose || "revocation",
      url: list.url || "",
      bitstring: list.bitstring || defaultBitstring,
      size: list.size || 131072,
      etag: list.etag || null,
      createdAt: now,
      updatedAt: now,
    };
    this.statusLists.set(statusList.url, statusList);
    return statusList;
  }

  async updateStatusList(url: string, bitstring: string, etag: string): Promise<void> {
    const list = this.statusLists.get(url);
    if (list) {
      list.bitstring = bitstring;
      list.etag = etag;
      list.updatedAt = new Date();
    }
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const proofs = await this.getProofAssets();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(Date.now() + 86400000);

    return {
      totalProofs: proofs.length,
      verifiedToday: proofs.filter(p =>
        p.verificationStatus === "verified" &&
        new Date(p.createdAt) >= today
      ).length,
      activeStatusLists: this.statusLists.size,
      pendingVerifications: proofs.filter(p => p.verificationStatus === "pending").length,
      failedMintCount: this.mintFailures.filter(f => !f.resolved).length,
      expiringSoon: proofs.filter(p => p.expiresAt && new Date(p.expiresAt) > new Date() && new Date(p.expiresAt) < tomorrow).length,
    };
  }

  async getSystemHealth(): Promise<SystemHealth> {
    return {
      database: "healthy",
      redis: "healthy",
      verifier: "healthy",
    };
  }

  // DLQ — in-memory stub (production uses PostgresStorage)
  private mintFailures: any[] = [];

  async recordMintFailure(failure: any): Promise<void> {
    this.mintFailures.push({ ...failure, failureId: crypto.randomUUID(), createdAt: new Date() });
  }

  async getUnresolvedMintFailures(limit: number = 50): Promise<any[]> {
    return this.mintFailures.filter(f => !f.resolved).slice(0, limit);
  }

  async resolveMintFailure(failureId: string, resolvedBy: string): Promise<void> {
    const f = this.mintFailures.find(f => f.failureId === failureId);
    if (f) {
      f.resolved = true;
      f.resolvedAt = new Date();
      f.resolvedBy = resolvedBy;
    }
  }

  // Partners — in-memory stub
  private partners: any[] = [];

  async listPartners(): Promise<any[]> {
    return this.partners;
  }

  async createPartner(partner: { name: string; contactEmail?: string | null; webhookUrl?: string | null; webhookSecret?: string | null }): Promise<any> {
    const p = { partnerId: crypto.randomUUID(), ...partner, active: true, createdAt: new Date(), updatedAt: new Date() };
    this.partners.push(p);
    return p;
  }
}

// PostgreSQL Storage Implementation
import { db } from "./db.js";
import { proofAssets as proofAssetsTable, auditEvents as auditEventsTable, statusLists as statusListsTable, mintFailures as mintFailuresTable, partners as partnersTable } from "../shared/schema.js";
import { eq, desc, sql, and } from "drizzle-orm";

export class PostgresStorage implements IStorage {
  async getProofAsset(id: string): Promise<ProofAsset | undefined> {
    const results = await db.select().from(proofAssetsTable).where(eq(proofAssetsTable.proofAssetId, id));
    return results[0] as ProofAsset | undefined;
  }

  async getProofAssets(): Promise<ProofAsset[]> {
    const results = await db.select().from(proofAssetsTable).orderBy(desc(proofAssetsTable.createdAt));
    return results as ProofAsset[];
  }

  async getRecentProofAssets(limit: number = 10): Promise<ProofAsset[]> {
    const results = await db.select().from(proofAssetsTable).orderBy(desc(proofAssetsTable.createdAt)).limit(limit);
    return results as ProofAsset[];
  }

  async getProofAssetCountByStatusList(statusListUrl: string): Promise<number> {
    const results = await db.select({ count: sql<number>`count(*)` })
      .from(proofAssetsTable)
      .where(eq(proofAssetsTable.statusListUrl, statusListUrl));
    return Number(results[0]?.count ?? 0);
  }

  async getProofAssetByDigest(partnerId: string | null, proofDigest: string): Promise<ProofAsset | undefined> {
    const conditions = [eq(proofAssetsTable.proofDigest, proofDigest)];
    if (partnerId) {
      conditions.push(eq(proofAssetsTable.partnerId, partnerId));
    }
    const results = await db.select().from(proofAssetsTable).where(and(...conditions)).limit(1);
    return results[0] as ProofAsset | undefined;
  }

  async createProofAsset(proof: Partial<ProofAsset>): Promise<ProofAsset> {
    // Compute expiresAt from Postgres clock (created_at + ttl_seconds) — one clock, zero drift.
    // Caller passes ttlSeconds but NOT expiresAt; Postgres owns both timestamps.
    const { expiresAt: _, ...proofWithoutExpiry } = proof as any;
    const results = await db.insert(proofAssetsTable).values({
      ...proofWithoutExpiry,
      expiresAt: proof.ttlSeconds
        ? sql`now() + (${proof.ttlSeconds} * interval '1 second')`
        : null,
    } as any).returning();
    return results[0] as ProofAsset;
  }

  async updateProofAsset(id: string, updates: Partial<ProofAsset>): Promise<ProofAsset> {
    const results = await db.update(proofAssetsTable)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(proofAssetsTable.proofAssetId, id))
      .returning();

    if (results.length === 0) {
      throw new Error(`Proof asset ${id} not found`);
    }
    return results[0] as ProofAsset;
  }

  async updateProofAssetStatus(id: string, status: string): Promise<void> {
    await db.update(proofAssetsTable)
      .set({ verificationStatus: status, updatedAt: new Date() })
      .where(eq(proofAssetsTable.proofAssetId, id));
  }

  async getAuditEvents(): Promise<AuditEvent[]> {
    const results = await db.select().from(auditEventsTable).orderBy(desc(auditEventsTable.timestamp));
    return results as AuditEvent[];
  }

  async createAuditEvent(event: Partial<AuditEvent>): Promise<AuditEvent> {
    const { computeAuditEventHash } = await import("./crypto-utils.js");

    // Get the last event to link hashes
    const lastEvents = await db.select().from(auditEventsTable).orderBy(desc(auditEventsTable.timestamp)).limit(1);
    const previousHash = lastEvents.length > 0 ? lastEvents[0].eventHash : null;

    // Compute cryptographic hash for this event
    const timestamp = new Date();
    const eventHash = await computeAuditEventHash(
      event.eventType!,
      event.assetId || null,
      event.payload || {},
      previousHash,
      timestamp
    );

    const results = await db.insert(auditEventsTable).values({
      ...event,
      timestamp,
      previousHash,
      eventHash,
    } as any).returning();
    return results[0] as AuditEvent;
  }

  async getStatusLists(): Promise<StatusList[]> {
    const results = await db.select().from(statusListsTable);
    return results as StatusList[];
  }

  async getStatusList(url: string): Promise<StatusList | undefined> {
    const results = await db.select().from(statusListsTable).where(eq(statusListsTable.url, url));
    return results[0] as StatusList | undefined;
  }

  async createStatusList(list: Partial<StatusList>): Promise<StatusList> {
    // Provide defaults matching MemStorage behavior
    const defaultBitstring = Buffer.alloc(16384).toString('base64');
    const statusList = {
      purpose: list.purpose || "revocation",
      url: list.url || "",
      bitstring: list.bitstring || defaultBitstring,
      size: list.size || 131072,
      etag: list.etag || `W/"${Date.now()}"`,
    };
    const results = await db.insert(statusListsTable).values(statusList as any).returning();
    return results[0] as StatusList;
  }

  async updateStatusList(url: string, bitstring: string, etag: string): Promise<void> {
    await db.update(statusListsTable)
      .set({ bitstring, etag, updatedAt: new Date() })
      .where(eq(statusListsTable.url, url));
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const proofs = await this.getProofAssets();
    const statusLists = await this.getStatusLists();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(Date.now() + 86400000);

    // Count unresolved mint failures
    const unresolvedFailures = await this.getUnresolvedMintFailures(1000);

    return {
      totalProofs: proofs.length,
      verifiedToday: proofs.filter(p =>
        p.verificationStatus === "verified" &&
        new Date(p.createdAt) >= today
      ).length,
      activeStatusLists: statusLists.length,
      pendingVerifications: proofs.filter(p => p.verificationStatus === "pending").length,
      failedMintCount: unresolvedFailures.length,
      expiringSoon: proofs.filter(p => p.expiresAt && new Date(p.expiresAt) > new Date() && new Date(p.expiresAt) < tomorrow).length,
    };
  }

  async getSystemHealth(): Promise<SystemHealth> {
    try {
      await db.select().from(proofAssetsTable).limit(1);
      return {
        database: "healthy",
        redis: "healthy",
        verifier: "healthy",
      };
    } catch (error) {
      return {
        database: "down",
        redis: "healthy",
        verifier: "healthy",
      };
    }
  }

  // DLQ — PostgreSQL-backed dead letter queue
  async recordMintFailure(failure: any): Promise<void> {
    await db.insert(mintFailuresTable).values(failure as any);
  }

  async getUnresolvedMintFailures(limit: number = 50): Promise<any[]> {
    const results = await db.select().from(mintFailuresTable)
      .where(eq(mintFailuresTable.resolved, false))
      .orderBy(desc(mintFailuresTable.createdAt))
      .limit(limit);
    return results;
  }

  async resolveMintFailure(failureId: string, resolvedBy: string): Promise<void> {
    await db.update(mintFailuresTable)
      .set({ resolved: true, resolvedAt: new Date(), resolvedBy, updatedAt: new Date() })
      .where(eq(mintFailuresTable.failureId, failureId));
  }

  // Partners — PostgreSQL-backed
  async listPartners(): Promise<any[]> {
    return db.select().from(partnersTable).orderBy(desc(partnersTable.createdAt));
  }

  async createPartner(partner: { name: string; contactEmail?: string | null; webhookUrl?: string | null; webhookSecret?: string | null }): Promise<any> {
    const result = await db.insert(partnersTable).values({
      name: partner.name,
      contactEmail: partner.contactEmail ?? null,
      webhookUrl: partner.webhookUrl ?? null,
      webhookSecret: partner.webhookSecret ?? null,
    }).returning();
    return result[0];
  }
}

export const storage = new PostgresStorage();
