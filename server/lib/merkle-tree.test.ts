// Smoke tests for RFC 6962 Merkle tree.
// Run: npx tsx server/lib/merkle-tree.test.ts

import {
  computeMerkleRoot,
  inclusionProof,
  verifyInclusionProof,
  canonicalEpochBytes,
  hashEpochCanonical,
} from "./merkle-tree.js";

let failures = 0;
function pass(name: string): void { console.log(`PASS ${name}`); }
function fail(name: string, reason: string): void { failures++; console.error(`FAIL ${name}\n  ${reason}`); }

// Known test vector: single leaf.
{
  const leaf = Buffer.from("hello", "utf8");
  const root = computeMerkleRoot([leaf]);
  // RFC 6962: leafHash(hello) = SHA256(0x00 || "hello")
  // = 13 bytes in, expect 64-hex output
  if (root.length !== 64) fail("single-leaf root is 64 hex", `got length=${root.length}`);
  else pass("single-leaf root is 64 hex");
}

// Two leaves, deterministic order.
{
  const root = computeMerkleRoot(["a", "b"]);
  const root2 = computeMerkleRoot(["a", "b"]);
  if (root !== root2) fail("deterministic two-leaf root", `mismatch`);
  else pass("deterministic two-leaf root");
}

// Odd-count handling: 3 leaves.
{
  const r3 = computeMerkleRoot(["a", "b", "c"]);
  const r3b = computeMerkleRoot(["a", "b", "c"]);
  if (r3 !== r3b) fail("deterministic three-leaf root", "");
  else pass("deterministic three-leaf root");
  // And different from 2-leaf.
  const r2 = computeMerkleRoot(["a", "b"]);
  if (r3 === r2) fail("three-leaf differs from two-leaf", "");
  else pass("three-leaf differs from two-leaf");
}

// Empty tree.
{
  const empty = computeMerkleRoot([]);
  if (empty.length !== 64) fail("empty-tree root is 64 hex", `got length=${empty.length}`);
  else pass("empty-tree root is 64 hex");
}

// Inclusion proof round-trip for various sizes.
for (const n of [1, 2, 3, 4, 7, 8, 16, 31, 100]) {
  const leaves = Array.from({ length: n }, (_, i) => `leaf-${i}`);
  const root = computeMerkleRoot(leaves);
  let allVerified = true;
  for (let idx = 0; idx < n; idx++) {
    const { proof, leafHashHex } = inclusionProof(leaves, idx);
    const ok = verifyInclusionProof(leafHashHex, idx, n, proof, root);
    if (!ok) {
      allVerified = false;
      fail(`inclusion proof n=${n} idx=${idx}`, `verify returned false`);
      break;
    }
  }
  if (allVerified) pass(`inclusion proofs round-trip for n=${n} (all indices)`);
}

// Tampered proof rejected.
{
  const leaves = ["a", "b", "c", "d"];
  const root = computeMerkleRoot(leaves);
  const { proof, leafHashHex } = inclusionProof(leaves, 2);
  const tamperedProof = [...proof];
  tamperedProof[0] = "f".repeat(64); // corrupt first sibling
  const ok = verifyInclusionProof(leafHashHex, 2, leaves.length, tamperedProof, root);
  if (ok) fail("tampered proof accepted", "verifier should reject corrupted sibling");
  else pass("tampered proof rejected");
}

// Canonical epoch bytes round-trip.
{
  const canon = canonicalEpochBytes({
    epochNumber: 42,
    merkleRoot: "a".repeat(64),
    treeSize: 100,
    previousEpochHash: "b".repeat(64),
    publishedAtIsoSeconds: 1_713_456_789,
  });
  const hash = hashEpochCanonical(canon);
  if (hash.length !== 64) fail("canonical epoch hash length", `got ${hash.length}`);
  else pass("canonical epoch hash length 64");

  // Deterministic
  const hash2 = hashEpochCanonical(canonicalEpochBytes({
    epochNumber: 42,
    merkleRoot: "a".repeat(64),
    treeSize: 100,
    previousEpochHash: "b".repeat(64),
    publishedAtIsoSeconds: 1_713_456_789,
  }));
  if (hash !== hash2) fail("canonical epoch deterministic", "two computations produced different hashes");
  else pass("canonical epoch deterministic");

  // Different epoch number => different hash
  const hash3 = hashEpochCanonical(canonicalEpochBytes({
    epochNumber: 43,
    merkleRoot: "a".repeat(64),
    treeSize: 100,
    previousEpochHash: "b".repeat(64),
    publishedAtIsoSeconds: 1_713_456_789,
  }));
  if (hash3 === hash) fail("canonical epoch changes with epoch_number", "");
  else pass("canonical epoch changes with epoch_number");
}

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nALL MERKLE TESTS PASSED");
  process.exit(0);
}
