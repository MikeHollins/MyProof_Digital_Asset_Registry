import { 
  type ProofAsset, 
  type InsertProofAsset,
  type AuditEvent,
  type InsertAuditEvent,
  type StatusList,
  type DashboardStats,
  type SystemHealth,
} from "@shared/schema";

export interface IStorage {
  // Proof Assets
  getProofAsset(id: string): Promise<ProofAsset | undefined>;
  getProofAssets(): Promise<ProofAsset[]>;
  getRecentProofAssets(limit?: number): Promise<ProofAsset[]>;
  createProofAsset(proof: Partial<ProofAsset>): Promise<ProofAsset>;
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

  async createProofAsset(proof: Partial<ProofAsset>): Promise<ProofAsset> {
    const id = crypto.randomUUID();
    const now = new Date();
    const asset: ProofAsset = {
      proofAssetId: id,
      proofAssetCommitment: proof.proofAssetCommitment || "",
      issuerDid: proof.issuerDid || "",
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
      createdAt: now,
      updatedAt: now,
    };
    this.proofAssets.set(id, asset);
    return asset;
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
    
    return {
      totalProofs: proofs.length,
      verifiedToday: proofs.filter(p => 
        p.verificationStatus === "verified" && 
        new Date(p.createdAt) >= today
      ).length,
      activeStatusLists: this.statusLists.size,
      pendingVerifications: proofs.filter(p => p.verificationStatus === "pending").length,
    };
  }

  async getSystemHealth(): Promise<SystemHealth> {
    return {
      database: "healthy",
      redis: "healthy",
      verifier: "healthy",
    };
  }
}

// PostgreSQL Storage Implementation
import { db } from "./db";
import { proofAssets as proofAssetsTable, auditEvents as auditEventsTable, statusLists as statusListsTable } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

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

  async createProofAsset(proof: Partial<ProofAsset>): Promise<ProofAsset> {
    const results = await db.insert(proofAssetsTable).values(proof as any).returning();
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
    // Get the last event to link hashes
    const lastEvents = await db.select().from(auditEventsTable).orderBy(desc(auditEventsTable.timestamp)).limit(1);
    const previousHash = lastEvents.length > 0 ? lastEvents[0].eventHash : null;
    
    // For now, use a simple hash (will be improved in task 3)
    const eventHash = crypto.randomUUID();
    
    const results = await db.insert(auditEventsTable).values({
      ...event,
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
    
    return {
      totalProofs: proofs.length,
      verifiedToday: proofs.filter(p => 
        p.verificationStatus === "verified" && 
        new Date(p.createdAt) >= today
      ).length,
      activeStatusLists: statusLists.length,
      pendingVerifications: proofs.filter(p => p.verificationStatus === "pending").length,
    };
  }

  async getSystemHealth(): Promise<SystemHealth> {
    try {
      // Test database connection
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
}

export const storage = new PostgresStorage();
