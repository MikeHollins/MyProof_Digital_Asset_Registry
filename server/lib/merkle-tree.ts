// Merkle tree utility — RFC 6962 domain-tagged SHA-256 tree with Tessera-style
// tile-friendly layout. Used by the hourly epoch publisher to produce a single
// root hash covering all audit events in the epoch.
//
// Domain tags (RFC 6962 §2.1):
//   leaf node:     SHA256(0x00 || leaf_bytes)
//   interior node: SHA256(0x01 || left_hash || right_hash)
//
// Odd-count handling: when the number of children at any level is odd, the
// last child is promoted (duplicate-free) — same as CT logs. This yields a
// deterministic tree for any leaf count.
//
// Consistency proofs (for client-side verifiers in Phase 7) are produced by
// walking the tree from leaf to root and collecting sibling hashes.

import { createHash } from "crypto";

const LEAF_TAG = Buffer.from([0x00]);
const INTERIOR_TAG = Buffer.from([0x01]);

function sha256(...chunks: Buffer[]): Buffer {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return h.digest();
}

export function leafHash(leaf: Buffer | string): Buffer {
  const b = typeof leaf === "string" ? Buffer.from(leaf, "utf8") : leaf;
  return sha256(LEAF_TAG, b);
}

export function interiorHash(left: Buffer, right: Buffer): Buffer {
  return sha256(INTERIOR_TAG, left, right);
}

// Compute Merkle root over an array of leaves. Returns the 32-byte root as a
// hex string (matches database schema `merkle_root` regex).
export function computeMerkleRoot(leaves: readonly (Buffer | string)[]): string {
  if (leaves.length === 0) {
    // Empty tree convention: SHA-256 of the empty string (RFC 6962 §2.1).
    return sha256(Buffer.alloc(0)).toString("hex");
  }
  let level: Buffer[] = leaves.map(leafHash);
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(interiorHash(level[i], level[i + 1]));
      } else {
        // Odd leaf at this level — promote (RFC 6962 style).
        next.push(level[i]);
      }
    }
    level = next;
  }
  return level[0].toString("hex");
}

// Produce an inclusion proof for the leaf at `index`. Returns an array of
// sibling hashes (hex) that the verifier combines with the leaf hash to
// reconstruct the root.
export function inclusionProof(
  leaves: readonly (Buffer | string)[],
  index: number,
): { proof: string[]; leafHashHex: string } {
  if (index < 0 || index >= leaves.length) {
    throw new Error(`inclusion proof index ${index} out of range [0, ${leaves.length})`);
  }
  if (leaves.length === 0) {
    throw new Error("inclusion proof requires at least one leaf");
  }
  let level: Buffer[] = leaves.map(leafHash);
  const leafHashHex = level[index].toString("hex");
  const proof: string[] = [];
  let i = index;
  while (level.length > 1) {
    const isRight = i % 2 === 1;
    const siblingIndex = isRight ? i - 1 : i + 1;
    if (siblingIndex < level.length) {
      proof.push(level[siblingIndex].toString("hex"));
    }
    // else: this is the lone odd node at this level — no sibling, it just propagates
    const next: Buffer[] = [];
    for (let j = 0; j < level.length; j += 2) {
      if (j + 1 < level.length) {
        next.push(interiorHash(level[j], level[j + 1]));
      } else {
        next.push(level[j]);
      }
    }
    level = next;
    i = Math.floor(i / 2);
  }
  return { proof, leafHashHex };
}

// Verify an inclusion proof client-side (used by the /transparency WASM
// verifier in Phase 7). Reconstruct the root from the leaf hash and proof
// siblings, compare against claimed root.
export function verifyInclusionProof(
  leafHashHex: string,
  index: number,
  leafCount: number,
  proof: readonly string[],
  expectedRootHex: string,
): boolean {
  if (leafCount === 0) return false;
  let current = Buffer.from(leafHashHex, "hex");
  let i = index;
  let count = leafCount;
  let proofIdx = 0;
  while (count > 1) {
    const siblingExists = !(i === count - 1 && count % 2 === 1);
    if (siblingExists) {
      if (proofIdx >= proof.length) return false;
      const sibling = Buffer.from(proof[proofIdx++], "hex");
      current = i % 2 === 1 ? interiorHash(sibling, current) : interiorHash(current, sibling);
    }
    count = Math.ceil(count / 2);
    i = Math.floor(i / 2);
  }
  return proofIdx === proof.length && current.toString("hex") === expectedRootHex;
}

// Canonical bytes to sign for an epoch root. Committing these bytes (not an
// object dump) is what the Ed25519 signature protects.
export function canonicalEpochBytes(params: {
  epochNumber: number;
  merkleRoot: string;
  treeSize: number;
  previousEpochHash: string | null;
  publishedAtIsoSeconds: number;
}): Buffer {
  const parts = [
    `epoch_number=${params.epochNumber}`,
    `merkle_root=${params.merkleRoot}`,
    `tree_size=${params.treeSize}`,
    `previous_epoch_hash=${params.previousEpochHash ?? ""}`,
    `published_at=${params.publishedAtIsoSeconds}`,
  ].join("\n");
  return Buffer.from(parts + "\n", "utf8");
}

// Hash the canonical epoch bytes to produce the `previous_epoch_hash` value
// of the NEXT epoch.
export function hashEpochCanonical(canonical: Buffer): string {
  return createHash("sha256").update(canonical).digest("hex");
}
