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
  updateStatusList(url: string, bitstring: Buffer, etag: string): Promise<void>;
  
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

export const storage = new MemStorage();
