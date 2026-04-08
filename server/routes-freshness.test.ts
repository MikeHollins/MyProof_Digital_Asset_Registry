import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Tests for the advisory freshness metadata added to PAR endpoints.
 *
 * Uses a minimal in-memory fixture — no database, no storage.ts import
 * (which triggers db.ts and requires DATABASE_URL).
 */

interface TestProofAsset {
  proofAssetId: string;
  proofDigest: string;
  proofFormat: string;
  digestAlg: string;
  issuerDid: string;
  policyHash: string;
  policyCid: string;
  constraintHash: string;
  verificationStatus: string;
  statusListUrl: string;
  statusListIndex: string;
  statusPurpose: string;
  ttlSeconds: number | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

// Minimal fixture — mirrors the route handler logic from routes.ts GET /api/proof-assets/:id
function createTestApp(assets: Map<string, TestProofAsset>) {
  const app = express();
  app.use(express.json());

  app.get("/api/proof-assets/:id", async (req, res) => {
    const proof = assets.get(req.params.id);
    if (!proof) {
      return res.status(404).json({ error: "Proof asset not found", code: "ASSET_NOT_FOUND" });
    }
    // This is the exact logic from routes.ts — testing it in isolation
    const now = Date.now();
    const ageSeconds = Math.floor((now - new Date(proof.createdAt).getTime()) / 1000);
    const isAdvisoryExpired = proof.expiresAt ? new Date(proof.expiresAt).getTime() < now : false;
    res.json({
      ...proof,
      createdAt: proof.createdAt.toISOString(),
      updatedAt: proof.updatedAt.toISOString(),
      expiresAt: proof.expiresAt ? proof.expiresAt.toISOString() : null,
      _freshness: {
        ageSeconds,
        isAdvisoryExpired,
      },
    });
  });

  return app;
}

function makeAsset(overrides: Partial<TestProofAsset> = {}): TestProofAsset {
  const now = new Date();
  return {
    proofAssetId: `test-${Math.random().toString(36).slice(2, 10)}`,
    proofDigest: "abc123",
    proofFormat: "ZK_PROOF",
    digestAlg: "sha2-256",
    issuerDid: "did:web:test",
    policyHash: "policy_US_21_age_gte",
    policyCid: "test-cid",
    constraintHash: "test-constraint",
    verificationStatus: "verified",
    statusListUrl: "https://registry.myproof.ai/status/revocation/default",
    statusListIndex: "1",
    statusPurpose: "revocation",
    ttlSeconds: 2592000,
    expiresAt: new Date(now.getTime() + 2592000 * 1000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("GET /api/proof-assets/:id — freshness metadata", () => {
  it("returns _freshness with ageSeconds and isAdvisoryExpired=false for fresh asset", async () => {
    const asset = makeAsset();
    const assets = new Map([[asset.proofAssetId, asset]]);
    const app = createTestApp(assets);

    const res = await request(app).get(`/api/proof-assets/${asset.proofAssetId}`);

    expect(res.status).toBe(200);
    expect(res.body._freshness).toBeDefined();
    expect(typeof res.body._freshness.ageSeconds).toBe("number");
    expect(res.body._freshness.ageSeconds).toBeGreaterThanOrEqual(0);
    expect(res.body._freshness.ageSeconds).toBeLessThan(5);
    expect(res.body._freshness.isAdvisoryExpired).toBe(false);
  });

  it("returns isAdvisoryExpired=true when expiresAt is in the past", async () => {
    const asset = makeAsset({
      expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      ttlSeconds: 86400,
    });
    const assets = new Map([[asset.proofAssetId, asset]]);
    const app = createTestApp(assets);

    const res = await request(app).get(`/api/proof-assets/${asset.proofAssetId}`);

    expect(res.status).toBe(200);
    // Asset is still returned — permanent record, not deleted
    expect(res.body.proofAssetId).toBe(asset.proofAssetId);
    expect(res.body._freshness.isAdvisoryExpired).toBe(true);
    expect(res.body._freshness.ageSeconds).toBeGreaterThanOrEqual(0);
  });

  it("returns isAdvisoryExpired=false when expiresAt is null", async () => {
    const asset = makeAsset({
      expiresAt: null,
      ttlSeconds: null,
    });
    const assets = new Map([[asset.proofAssetId, asset]]);
    const app = createTestApp(assets);

    const res = await request(app).get(`/api/proof-assets/${asset.proofAssetId}`);

    expect(res.status).toBe(200);
    expect(res.body._freshness.isAdvisoryExpired).toBe(false);
    expect(res.body.expiresAt).toBeNull();
  });

  it("returns 404 for non-existent asset", async () => {
    const app = createTestApp(new Map());

    const res = await request(app).get("/api/proof-assets/nonexistent-id");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ASSET_NOT_FOUND");
  });

  it("preserves all original proof fields alongside _freshness", async () => {
    const asset = makeAsset({ proofDigest: "full-fields-test" });
    const assets = new Map([[asset.proofAssetId, asset]]);
    const app = createTestApp(assets);

    const res = await request(app).get(`/api/proof-assets/${asset.proofAssetId}`);

    expect(res.status).toBe(200);
    expect(res.body.proofAssetId).toBe(asset.proofAssetId);
    expect(res.body.proofDigest).toBe("full-fields-test");
    expect(res.body.proofFormat).toBe("ZK_PROOF");
    expect(res.body.issuerDid).toBe("did:web:test");
    expect(res.body.verificationStatus).toBe("verified");
    expect(res.body.ttlSeconds).toBe(2592000);
    expect(res.body.createdAt).toBeDefined();
    expect(res.body._freshness).toBeDefined();
  });

  it("computes ageSeconds correctly for an asset created 1 hour ago", async () => {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const asset = makeAsset({ createdAt: oneHourAgo });
    const assets = new Map([[asset.proofAssetId, asset]]);
    const app = createTestApp(assets);

    const res = await request(app).get(`/api/proof-assets/${asset.proofAssetId}`);

    expect(res.status).toBe(200);
    // Should be approximately 3600 seconds (±5s for test execution time)
    expect(res.body._freshness.ageSeconds).toBeGreaterThanOrEqual(3595);
    expect(res.body._freshness.ageSeconds).toBeLessThanOrEqual(3605);
  });
});
