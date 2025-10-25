import { db } from "../db";
import { jtiReplay } from "@shared/schema";
import { eq, lt } from "drizzle-orm";

/**
 * Check if a JTI (JWT ID) has been used before (replay attack protection).
 * If not seen before, records it in the database with expiration time.
 * 
 * @param jti - The JWT ID from the receipt
 * @param expSec - The expiration time from the JWT (exp claim in seconds)
 * @returns true if the JTI has been seen before (replay), false if new
 */
export async function isReplayed(jti: string, expSec: number): Promise<boolean> {
  const expAt = new Date(expSec * 1000);

  try {
    // Try to insert the JTI
    // If it already exists (primary key constraint), the insert will fail
    await db.insert(jtiReplay).values({
      jti,
      expAt,
    });
    
    // Successfully inserted = first time seeing this JTI
    return false;
  } catch (error: any) {
    // Check if it's a unique constraint violation (code 23505 for PostgreSQL)
    if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
      // JTI already exists = replay attack
      return true;
    }
    
    // Some other error occurred
    console.error('[jti-repo] Error checking replay:', error);
    throw error;
  }
}

/**
 * Remove expired JTI entries from the database.
 * Call this periodically (e.g., every 5 minutes) to prevent unbounded growth.
 * 
 * @returns Number of entries deleted
 */
export async function cleanupExpiredJti(): Promise<number> {
  const now = new Date();
  
  try {
    const result = await db
      .delete(jtiReplay)
      .where(lt(jtiReplay.expAt, now))
      .returning();
    
    const deletedCount = result.length;
    
    if (deletedCount > 0) {
      console.log(`[jti-repo] Cleaned up ${deletedCount} expired JTI entries`);
    }
    
    return deletedCount;
  } catch (error) {
    console.error('[jti-repo] Error during cleanup:', error);
    throw error;
  }
}

/**
 * Get the total count of JTI entries in the database (for monitoring).
 */
export async function getJtiCount(): Promise<number> {
  try {
    const result = await db.select().from(jtiReplay);
    return result.length;
  } catch (error) {
    console.error('[jti-repo] Error getting JTI count:', error);
    return 0;
  }
}
