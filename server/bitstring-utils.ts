/**
 * W3C Bitstring Status List Utilities
 * Implements bitwise operations for revocation and suspension tracking
 * 
 * Reference: https://www.w3.org/TR/vc-bitstring-status-list/
 */

/**
 * Check if a bit is set at a given index in a bitstring
 */
export function checkBit(bitstring: Buffer, index: number): boolean {
  const byteIndex = Math.floor(index / 8);
  const bitIndex = index % 8;
  
  if (byteIndex >= bitstring.length) {
    return false;
  }
  
  return (bitstring[byteIndex] & (1 << bitIndex)) !== 0;
}

/**
 * Set a bit to 1 at a given index in a bitstring
 */
export function setBit(bitstring: Buffer, index: number): void {
  const byteIndex = Math.floor(index / 8);
  const bitIndex = index % 8;
  
  if (byteIndex < bitstring.length) {
    bitstring[byteIndex] |= (1 << bitIndex);
  }
}

/**
 * Clear a bit to 0 at a given index in a bitstring
 */
export function clearBit(bitstring: Buffer, index: number): void {
  const byteIndex = Math.floor(index / 8);
  const bitIndex = index % 8;
  
  if (byteIndex < bitstring.length) {
    bitstring[byteIndex] &= ~(1 << bitIndex);
  }
}

/**
 * Flip a bit at a given index in a bitstring
 */
export function flipBit(bitstring: Buffer, index: number): void {
  const byteIndex = Math.floor(index / 8);
  const bitIndex = index % 8;
  
  if (byteIndex < bitstring.length) {
    bitstring[byteIndex] ^= (1 << bitIndex);
  }
}

/**
 * Get the status of a credential based on its status list entry
 * 
 * @param bitstring - Base64-encoded bitstring
 * @param index - Index in the bitstring
 * @param purpose - Purpose of the status list (revocation or suspension)
 * @returns Status object
 */
export function getCredentialStatus(
  bitstring: string,
  index: number,
  purpose: string
): {
  isActive: boolean;
  isRevoked: boolean;
  isSuspended: boolean;
  statusPurpose: string;
} {
  const buffer = Buffer.from(bitstring, 'base64');
  const bitSet = checkBit(buffer, index);
  
  if (purpose === "revocation") {
    return {
      isActive: !bitSet,
      isRevoked: bitSet,
      isSuspended: false,
      statusPurpose: purpose,
    };
  } else if (purpose === "suspension") {
    return {
      isActive: !bitSet,
      isRevoked: false,
      isSuspended: bitSet,
      statusPurpose: purpose,
    };
  }
  
  return {
    isActive: true,
    isRevoked: false,
    isSuspended: false,
    statusPurpose: purpose,
  };
}

/**
 * Validate that an index is within the bounds of a bitstring
 */
export function validateIndex(bitstring: Buffer, index: number): void {
  const maxIndex = bitstring.length * 8 - 1;
  if (index < 0 || index > maxIndex) {
    throw new Error(
      `Index ${index} is out of bounds for bitstring of length ${bitstring.length} bytes (max index: ${maxIndex})`
    );
  }
}

/**
 * Apply multiple operations to a bitstring
 * Throws error if any index is out of bounds
 */
export function applyOperations(
  bitstring: Buffer,
  operations: Array<{ op: "set" | "clear" | "flip"; index: number }>
): void {
  // Validate all indices first
  for (const operation of operations) {
    validateIndex(bitstring, operation.index);
  }
  
  // Apply operations only after all validations pass
  for (const operation of operations) {
    switch (operation.op) {
      case "set":
        setBit(bitstring, operation.index);
        break;
      case "clear":
        clearBit(bitstring, operation.index);
        break;
      case "flip":
        flipBit(bitstring, operation.index);
        break;
    }
  }
}

/**
 * Compress bitstring using gzip (W3C recommends compression for large lists)
 * Note: This is a placeholder - full W3C implementation uses GZIP compression
 */
export function compressBitstring(bitstring: Buffer): Buffer {
  // For now, return as-is
  // In production, use zlib.gzipSync(bitstring)
  return bitstring;
}

/**
 * Decompress bitstring
 */
export function decompressBitstring(compressed: Buffer): Buffer {
  // For now, return as-is
  // In production, use zlib.gunzipSync(compressed)
  return compressed;
}
