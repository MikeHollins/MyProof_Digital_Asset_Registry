#!/usr/bin/env node
/**
 * Phase 2 & 3 Integration Test
 * 
 * Tests all new endpoints:
 * - Transfer (POST /api/proof-assets/:id/transfer)
 * - Usage (POST /api/proof-assets/:id/use)
 * - Audit Export (GET /api/audit/root, GET /api/audit/proof/:eventId)
 */

const BASE_URL = 'http://localhost:5000';

async function request(method, path, body = null) {
  const opts = { method };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

async function testPhase3Transfer() {
  console.log('\n=== Phase 3: Asset Transfer Test ===');
  
  // Get first proof asset
  const { data: proofs } = await request('GET', '/api/proof-assets');
  if (!proofs || proofs.length === 0) {
    console.log('❌ No proofs found - skipping transfer test');
    return;
  }
  
  const assetId = proofs[0].proofAssetId;
  const currentDid = proofs[0].issuerDid;
  console.log(`Testing with asset ${assetId}`);
  console.log(`Current owner: ${currentDid}`);
  
  // Transfer to new DID
  const newDid = `did:example:new-owner-${Date.now()}`;
  console.log(`\nTransferring to: ${newDid}`);
  
  const { status, data } = await request('POST', `/api/proof-assets/${assetId}/transfer`, {
    to_did: newDid
  });
  
  if (status === 200 && data.ok) {
    console.log('✅ Transfer successful');
    console.log(`   Transfer ID: ${data.transfer.transferId}`);
    console.log(`   From: ${data.from_did}`);
    console.log(`   To: ${data.to_did}`);
  } else {
    console.log('❌ Transfer failed:', data.error);
  }
  
  // Get transfer history
  const { data: history } = await request('GET', `/api/proof-assets/${assetId}/transfers`);
  console.log(`\n📜 Transfer history: ${history.count} transfers`);
  if (history.transfers && history.transfers.length > 0) {
    history.transfers.forEach((t, i) => {
      console.log(`   ${i + 1}. ${t.fromDid} → ${t.toDid} (${new Date(t.createdAt).toISOString()})`);
    });
  }
  
  return assetId;
}

async function testPhase3Usage(assetId) {
  console.log('\n=== Phase 3: Asset Usage Test ===');
  
  if (!assetId) {
    console.log('❌ No asset ID provided - skipping usage test');
    return;
  }
  
  console.log(`Testing with asset ${assetId}`);
  
  // Record usage
  const { status, data } = await request('POST', `/api/proof-assets/${assetId}/use`, {
    audience: 'test-verifier',
    nonce: `nonce-${Date.now()}`
  });
  
  if (status === 200 && data.ok) {
    console.log('✅ Usage recorded successfully');
    console.log(`   Usage ID: ${data.usage.usageId}`);
    console.log(`   Receipt (JWS): ${data.receipt.substring(0, 50)}...`);
  } else {
    console.log('❌ Usage recording failed:', data.error);
  }
  
  // Get usage history
  const { data: history } = await request('GET', `/api/proof-assets/${assetId}/usage`);
  console.log(`\n📊 Usage history: ${history.total_uses} total uses`);
  if (history.usages && history.usages.length > 0) {
    history.usages.slice(0, 5).forEach((u, i) => {
      console.log(`   ${i + 1}. ${u.usageId} at ${new Date(u.usedAt).toISOString()}`);
    });
    if (history.usages.length > 5) {
      console.log(`   ... and ${history.usages.length - 5} more`);
    }
  }
}

async function testPhase2AuditExport() {
  console.log('\n=== Phase 2: Audit Export (Merkle) Test ===');
  
  // Get Merkle root
  const { status: rootStatus, data: rootData } = await request('GET', '/api/audit/root');
  
  if (rootStatus === 200 && rootData.ok) {
    console.log('✅ Merkle root computed successfully');
    console.log(`   Root hash: ${rootData.root}`);
    console.log(`   Leaf count: ${rootData.leaf_count}`);
    console.log(`   Tree height: ${rootData.tree_height}`);
  } else {
    console.log('❌ Merkle root failed:', rootData.error);
    return;
  }
  
  // Get a Merkle proof for first event (if exists)
  const { data: events } = await request('GET', '/api/audit-events');
  if (events && events.length > 0) {
    const eventId = events[0].eventId;
    console.log(`\n📄 Getting Merkle proof for event ${eventId}`);
    
    const { status: proofStatus, data: proofData } = await request('GET', `/api/audit/proof/${eventId}`);
    
    if (proofStatus === 200 && proofData.ok) {
      console.log('✅ Merkle proof generated successfully');
      if (proofData.event) {
        console.log(`   Event: ${proofData.event.event_type || proofData.event.eventType} (${proofData.event.event_id || proofData.event.eventId})`);
      }
      console.log(`   Leaf hash: ${proofData.leaf_hash}`);
      if (proofData.proof && proofData.proof.siblings) {
        console.log(`   Proof siblings: ${proofData.proof.siblings.length} hashes`);
      }
      console.log(`   Verified: ${proofData.verified ? '✓' : '✗'}`);
    } else {
      console.log('❌ Merkle proof failed:', proofData.error);
    }
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  Phase 2 & 3 Integration Test Suite      ║');
  console.log('╚════════════════════════════════════════════╝');
  
  try {
    // Phase 3 Tests
    const assetId = await testPhase3Transfer();
    await testPhase3Usage(assetId);
    
    // Phase 2 Tests
    await testPhase2AuditExport();
    
    console.log('\n✅ All tests completed!\n');
  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
    process.exit(1);
  }
}

main();
