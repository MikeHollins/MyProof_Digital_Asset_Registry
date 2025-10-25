import Redis from "ioredis";

/**
 * Redis Client for Replay Cache and Status List Caching
 * 
 * In production, use Redis for:
 * - JWT replay protection (jti deduplication)
 * - W3C Status List caching with ETag
 * 
 * In development, falls back to in-memory Map if REDIS_URL not set
 */

let redisClient: Redis | null = null;
let inMemoryCache: Map<string, { value: string; expiresAt: number }> | null = null;

export function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;
  
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[redis] ⚠️  PRODUCTION WARNING: REDIS_URL not set. Replay cache will not work across instances.');
    } else {
      console.log('[redis] No REDIS_URL found, using in-memory cache (development only)');
    }
    return null;
  }
  
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });
    
    redisClient.on('error', (err) => {
      console.error('[redis] Connection error:', err.message);
    });
    
    redisClient.on('connect', () => {
      console.log('[redis] ✓ Connected successfully');
    });
    
    return redisClient;
  } catch (error: any) {
    console.error('[redis] Failed to initialize:', error.message);
    return null;
  }
}

// In-memory fallback for development
function getInMemoryCache(): Map<string, { value: string; expiresAt: number }> {
  if (!inMemoryCache) {
    inMemoryCache = new Map();
    
    // Clean up expired entries every minute
    setInterval(() => {
      const now = Date.now();
      const entries = Array.from(inMemoryCache!.entries());
      for (const [key, entry] of entries) {
        if (entry.expiresAt < now) {
          inMemoryCache!.delete(key);
        }
      }
    }, 60000);
  }
  return inMemoryCache;
}

/**
 * Set a key with TTL (milliseconds)
 * Returns 'OK' if new key created, null if key already exists (for NX mode)
 */
export async function setWithTTL(
  key: string,
  value: string,
  ttlMs: number,
  mode: 'NX' | 'XX' | null = null
): Promise<'OK' | null> {
  const redis = getRedisClient();
  
  if (redis) {
    // Use Redis
    if (mode === 'NX') {
      // Only set if key doesn't exist
      const result = await redis.set(key, value, 'PX', ttlMs, 'NX');
      return result;
    } else if (mode === 'XX') {
      // Only set if key exists
      const result = await redis.set(key, value, 'PX', ttlMs, 'XX');
      return result;
    } else {
      // Always set
      await redis.set(key, value, 'PX', ttlMs);
      return 'OK';
    }
  } else {
    // Use in-memory fallback
    const cache = getInMemoryCache();
    const exists = cache.has(key);
    
    if (mode === 'NX' && exists) {
      return null; // Key already exists, don't set
    }
    if (mode === 'XX' && !exists) {
      return null; // Key doesn't exist, don't set
    }
    
    cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    return 'OK';
  }
}

/**
 * Get a key value
 */
export async function get(key: string): Promise<string | null> {
  const redis = getRedisClient();
  
  if (redis) {
    return await redis.get(key);
  } else {
    const cache = getInMemoryCache();
    const entry = cache.get(key);
    
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      cache.delete(key);
      return null;
    }
    
    return entry.value;
  }
}

/**
 * Check if key exists
 */
export async function exists(key: string): Promise<boolean> {
  const redis = getRedisClient();
  
  if (redis) {
    const count = await redis.exists(key);
    return count > 0;
  } else {
    const cache = getInMemoryCache();
    const entry = cache.get(key);
    
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
      cache.delete(key);
      return false;
    }
    
    return true;
  }
}

/**
 * Delete a key
 */
export async function del(key: string): Promise<void> {
  const redis = getRedisClient();
  
  if (redis) {
    await redis.del(key);
  } else {
    const cache = getInMemoryCache();
    cache.delete(key);
  }
}
