import { createHash } from "node:crypto";

/**
 * Merkle Tree utilities for audit transparency
 * 
 * Provides cryptographic proofs that a specific audit event is included
 * in the published Merkle tree root, enabling third-party verification.
 */

/**
 * Compute SHA-256 hash
 */
function sha256(buf: Buffer | string): Buffer {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return createHash("sha256").update(b).digest();
}

/**
 * Compute leaf hash for audit event
 * 
 * Creates deterministic hash of event data using JSON canonicalization
 * 
 * @param event - Audit event object
 * @returns SHA-256 hash of canonicalized event JSON
 */
export function leafHash(event: any): Buffer {
  const canonical = JSON.stringify(event);
  return sha256(Buffer.from(canonical));
}

/**
 * Compute Merkle root from leaf hashes
 * 
 * Builds binary Merkle tree and returns root hash.
 * Uses duplicate last node for odd-sized levels.
 * 
 * @param leaves - Array of leaf hashes
 * @returns Root hash of Merkle tree
 */
export function merkleRoot(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) {
    return sha256("");
  }

  let level = leaves.slice();

  while (level.length > 1) {
    const next: Buffer[] = [];

    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : level[i]; // Duplicate last if odd
      next.push(sha256(Buffer.concat([a, b])));
    }

    level = next;
  }

  return level[0];
}

/**
 * Generate Merkle inclusion proof for leaf at index
 * 
 * Returns array of sibling hashes needed to reconstruct root.
 * Verifier can recompute root by hashing leaf with siblings.
 * 
 * @param leaves - All leaf hashes in tree
 * @param index - Index of leaf to prove (0-based)
 * @returns Array of sibling hashes for inclusion proof
 */
export function merkleProof(leaves: Buffer[], index: number): Buffer[] {
  if (index < 0 || index >= leaves.length) {
    throw new Error("Index out of bounds");
  }

  const proof: Buffer[] = [];
  let level = leaves.slice();
  let idx = index;

  while (level.length > 1) {
    const next: Buffer[] = [];

    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : level[i];

      // If current pair contains our target index, save the sibling
      if (i === idx || i + 1 === idx) {
        const sibling = i === idx ? (i + 1 < level.length ? b : a) : a;
        proof.push(sibling);
        idx = Math.floor(i / 2);
      }

      next.push(sha256(Buffer.concat([a, b])));
    }

    level = next;
  }

  return proof;
}

/**
 * Verify Merkle inclusion proof
 * 
 * @param leaf - Leaf hash to verify
 * @param proof - Array of sibling hashes from merkleProof()
 * @param root - Expected root hash
 * @param index - Leaf index in original tree
 * @returns True if proof validates
 */
export function verifyMerkleProof(
  leaf: Buffer,
  proof: Buffer[],
  root: Buffer,
  index: number
): boolean {
  let current = leaf;
  let idx = index;

  for (const sibling of proof) {
    // Determine if current is left or right child
    const isLeft = idx % 2 === 0;
    current = isLeft
      ? sha256(Buffer.concat([current, sibling]))
      : sha256(Buffer.concat([sibling, current]));
    idx = Math.floor(idx / 2);
  }

  return current.equals(root);
}
