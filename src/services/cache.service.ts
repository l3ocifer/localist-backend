import Redis from 'ioredis';
import config from '../config';

export class CacheService {
  private static instance: CacheService;
  private redis: Redis;
  private defaultTTL: number = 3600; // 1 hour default

  private constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      lazyConnect: true, // Don't fail on startup if Redis is unavailable
    });

    this.redis.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    this.redis.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });
  }

  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache with optional TTL
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await this.redis.setex(key, ttl, serialized);
      } else {
        await this.redis.setex(key, this.defaultTTL, serialized);
      }
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
    }
  }

  /**
   * Delete multiple keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error(`Cache delete pattern error for ${pattern}:`, error);
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get or set cache with factory function
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * Increment a counter
   */
  async increment(key: string, by: number = 1): Promise<number> {
    try {
      return await this.redis.incrby(key, by);
    } catch (error) {
      console.error(`Cache increment error for key ${key}:`, error);
      return 0;
    }
  }

  /**
   * Set hash field
   */
  async hset(key: string, field: string, value: string): Promise<void> {
    try {
      await this.redis.hset(key, field, value);
    } catch (error) {
      console.error(`Cache hset error for key ${key}:`, error);
    }
  }

  /**
   * Get hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.redis.hget(key, field);
    } catch (error) {
      console.error(`Cache hget error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string> | null> {
    try {
      const result = await this.redis.hgetall(key);
      return Object.keys(result).length > 0 ? result : null;
    } catch (error) {
      console.error(`Cache hgetall error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Add to sorted set
   */
  async zadd(key: string, score: number, member: string): Promise<void> {
    try {
      await this.redis.zadd(key, score, member);
    } catch (error) {
      console.error(`Cache zadd error for key ${key}:`, error);
    }
  }

  /**
   * Get top members from sorted set
   */
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.redis.zrevrange(key, start, stop);
    } catch (error) {
      console.error(`Cache zrevrange error for key ${key}:`, error);
      return [];
    }
  }

  /**
   * Flush all cache
   */
  async flush(): Promise<void> {
    try {
      await this.redis.flushdb();
    } catch (error) {
      console.error('Cache flush error:', error);
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}

// Cache key generators
export const CacheKeys = {
  user: (userId: string) => `user:${userId}`,
  venue: (venueId: string) => `venue:${venueId}`,
  city: (cityId: string) => `city:${cityId}`,
  cityVenues: (cityId: string) => `city:${cityId}:venues`,
  list: (listId: string) => `list:${listId}`,
  recommendations: (userId: string, cityId: string) => `recommendations:${userId}:${cityId}`,
  trending: (cityId: string) => `trending:${cityId}`,
  search: (query: string, filters: string) => `search:${query}:${filters}`,
  session: (sessionId: string) => `session:${sessionId}`,
};