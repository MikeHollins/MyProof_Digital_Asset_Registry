import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertProofAssetSchema, updateStatusListSchema } from "@shared/schema";
import { z } from "zod";
import { generateProofCommitment, generateCID } from "./crypto-utils";
import { verifyProof } from "./proof-verification";

// Status list allocation
function allocateStatusRef(purpose: string): { statusListUrl: string; statusListIndex: string; statusPurpose: string } {
  const baseUrl = process.env.STATUS_BASE_URL || "https://status.example.com/lists";
  const index = Math.floor(Math.random() * 100000);
  return {
    statusListUrl: `${baseUrl}/${purpose}/default`,
    statusListIndex: String(index),
    statusPurpose: purpose,
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check
  app.get("/api/health", async (_req, res) => {
    const health = await storage.getSystemHealth();
    res.json({ ok: true, ...health });
  });

  // Dashboard stats
  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all proof assets
  app.get("/api/proof-assets", async (_req, res) => {
    try {
      const proofs = await storage.getProofAssets();
      res.json(proofs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get recent proof assets
  app.get("/api/proof-assets/recent", async (_req, res) => {
    try {
      const proofs = await storage.getRecentProofAssets(10);
      res.json(proofs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single proof asset
  app.get("/api/proof-assets/:id", async (req, res) => {
    try {
      const proof = await storage.getProofAsset(req.params.id);
      if (!proof) {
        return res.status(404).json({ error: "Proof asset not found" });
      }
      res.json(proof);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create new proof asset
  app.post("/api/proof-assets", async (req, res) => {
    try {
      // Validate request body
      const body = insertProofAssetSchema.parse(req.body);

      // Verify the proof with issuer context
      const verification = await verifyProof(body.verifier_proof_ref, {
        issuerDid: body.issuerDid,
      });
      
      if (!verification.ok) {
        return res.status(400).json({
          type: "about:blank",
          title: "Invalid proof",
          status: 400,
          detail: verification.reason || "Proof verification failed",
        });
      }

      // Generate commitment using RFC 8785 JCS + CIDv1
      const commitmentData = {
        policy_cid: body.policyCid,
        policy_hash: body.policyHash,
        constraint_cid: body.constraintCid,
        constraint_hash: body.constraintHash,
        circuit_cid: body.circuitCid,
        schema_cid: body.schemaCid,
        license: body.license || {},
        proof_id: crypto.randomUUID(),
      };
      const proofAssetCommitment = await generateProofCommitment(commitmentData);

      // Allocate status list reference
      const statusRef = allocateStatusRef("revocation");

      // Create status list if it doesn't exist
      let statusList = await storage.getStatusList(statusRef.statusListUrl);
      if (!statusList) {
        statusList = await storage.createStatusList({
          purpose: "revocation",
          url: statusRef.statusListUrl,
          bitstring: Buffer.alloc(16384).toString('base64'), // 131072 bits, base64-encoded
          size: 131072,
          etag: `W/"${Date.now()}"`,
        });
      }

      // Create proof asset with verification metadata
      const proof = await storage.createProofAsset({
        proofAssetCommitment,
        issuerDid: body.issuerDid,
        subjectBinding: body.subjectBinding,
        proofFormat: body.proofFormat,
        proofDigest: body.proofDigest,
        digestAlg: body.digestAlg,
        proofUri: body.verifier_proof_ref.proof_uri,
        constraintHash: body.constraintHash,
        constraintCid: body.constraintCid,
        policyHash: body.policyHash,
        policyCid: body.policyCid,
        circuitOrSchemaId: body.circuitOrSchemaId,
        circuitCid: body.circuitCid,
        schemaCid: body.schemaCid,
        license: body.license,
        statusListUrl: statusRef.statusListUrl,
        statusListIndex: statusRef.statusListIndex,
        statusPurpose: statusRef.statusPurpose,
        verificationStatus: "verified",
        verificationAlgorithm: verification.algorithm,
        verificationPublicKeyDigest: verification.publicKeyDigest,
        verificationTimestamp: verification.verifiedAt ? new Date(verification.verifiedAt) : new Date(),
        verificationMetadata: verification.derivedFacts,
      });

      // Create audit event
      await storage.createAuditEvent({
        eventType: "MINT",
        assetId: proof.proofAssetId,
        payload: {
          issuer_did: proof.issuerDid,
          proof_format: proof.proofFormat,
          commitment: proofAssetCommitment,
        },
        traceId: crypto.randomUUID(),
      });

      res.status(201).json(proof);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          type: "about:blank",
          title: "Validation error",
          status: 400,
          detail: error.errors[0]?.message || "Invalid request body",
        });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get audit events
  app.get("/api/audit-events", async (_req, res) => {
    try {
      const events = await storage.getAuditEvents();
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Verify audit chain integrity
  app.get("/api/audit-events/verify-chain", async (_req, res) => {
    try {
      const { verifyAuditChainLink } = await import("./crypto-utils");
      const events = await storage.getAuditEvents();
      
      // Sort events in chronological order (oldest first)
      const sortedEvents = [...events].reverse();
      
      // Verify each event's hash and previousHash linkage
      const results = await Promise.all(sortedEvents.map(async (event, index) => {
        // Verify the event's own hash is correct
        const hashValid = await verifyAuditChainLink({
          eventType: event.eventType,
          assetId: event.assetId,
          payload: event.payload,
          previousHash: event.previousHash,
          eventHash: event.eventHash,
          timestamp: event.timestamp,
        });
        
        // Verify previousHash matches the prior event's hash
        let linkageValid = true;
        let linkageReason = "";
        
        if (index === 0) {
          // First event should have null previousHash
          linkageValid = event.previousHash === null;
          if (!linkageValid) linkageReason = "First event should have null previousHash";
        } else {
          // Subsequent events should link to previous event's hash
          const previousEvent = sortedEvents[index - 1];
          linkageValid = event.previousHash === previousEvent.eventHash;
          if (!linkageValid) {
            linkageReason = `previousHash mismatch: expected ${previousEvent.eventHash}, got ${event.previousHash}`;
          }
        }
        
        const isValid = hashValid && linkageValid;
        
        return {
          eventId: event.eventId,
          eventType: event.eventType,
          isValid,
          hashValid,
          linkageValid,
          linkageReason: linkageReason || undefined,
          index,
        };
      }));
      
      const allValid = results.every(r => r.isValid);
      const invalidEvents = results.filter(r => !r.isValid);
      
      res.json({
        chainValid: allValid,
        totalEvents: events.length,
        validEvents: results.filter(r => r.isValid).length,
        invalidEvents: invalidEvents.length,
        details: results,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Check status of a specific proof asset
  app.get("/api/proof-assets/:id/status", async (req, res) => {
    try {
      const proof = await storage.getProofAsset(req.params.id);
      if (!proof) {
        return res.status(404).json({ error: "Proof asset not found" });
      }
      
      // Get the status list
      const statusList = await storage.getStatusList(proof.statusListUrl);
      if (!statusList) {
        return res.status(404).json({ error: "Status list not found" });
      }
      
      // Check the status using bitstring utilities
      const { getCredentialStatus } = await import("./bitstring-utils");
      const status = getCredentialStatus(
        statusList.bitstring,
        parseInt(proof.statusListIndex),
        proof.statusPurpose
      );
      
      res.json({
        proofAssetId: proof.proofAssetId,
        statusListUrl: proof.statusListUrl,
        statusListIndex: proof.statusListIndex,
        ...status,
        checkedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get status lists
  app.get("/api/status-lists", async (_req, res) => {
    try {
      const lists = await storage.getStatusLists();
      res.json(lists);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update status list
  app.post("/api/status-lists/:purpose/update", async (req, res) => {
    try {
      const body = updateStatusListSchema.parse(req.body);
      
      let statusList = await storage.getStatusList(body.statusListUrl);
      if (!statusList) {
        return res.status(404).json({ error: "Status list not found" });
      }

      // Decode base64 bitstring, apply operations using utilities, re-encode
      const { applyOperations } = await import("./bitstring-utils");
      const bitstring = Buffer.from(statusList.bitstring, 'base64');
      applyOperations(bitstring, body.operations);

      const etag = `W/"${Date.now()}"`;
      await storage.updateStatusList(body.statusListUrl, bitstring.toString('base64'), etag);

      // Create audit event for status update
      await storage.createAuditEvent({
        eventType: "STATUS_UPDATE",
        assetId: null, // Could be linked to specific proof if available
        payload: {
          status_list_url: body.statusListUrl,
          operations: body.operations,
          purpose: req.params.purpose,
        },
        traceId: crypto.randomUUID(),
      });

      res.json({ updated: true, etag });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request body" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
