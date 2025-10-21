"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheKeys = exports.CacheService = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = __importDefault(require("../config"));
class CacheService {
    static instance;
    redis;
    defaultTTL = 3600; // 1 hour default
    constructor() {
        this.redis = new ioredis_1.default({
            host: config_1.default.redis.host,
            port: config_1.default.redis.port,
            password: process.env.REDIS_PASSWORD,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            maxRetriesPerRequest: 3,
        });
        this.redis.on('error', (err) => {
            console.error('Redis connection error:', err);
        });
        this.redis.on('connect', () => {
            console.log('✅ Redis connected successfully');
        });
    }
    static getInstance() {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService();
        }
        return CacheService.instance;
    }
    /**
     * Get value from cache
     */
    async get(key) {
        try {
            const value = await this.redis.get(key);
            return value ? JSON.parse(value) : null;
        }
        catch (error) {
            console.error(`Cache get error for key ${key}:`, error);
            return null;
        }
    }
    /**
     * Set value in cache with optional TTL
     */
    async set(key, value, ttl) {
        try {
            const serialized = JSON.stringify(value);
            if (ttl) {
                await this.redis.setex(key, ttl, serialized);
            }
            else {
                await this.redis.setex(key, this.defaultTTL, serialized);
            }
        }
        catch (error) {
            console.error(`Cache set error for key ${key}:`, error);
        }
    }
    /**
     * Delete value from cache
     */
    async delete(key) {
        try {
            await this.redis.del(key);
        }
        catch (error) {
            console.error(`Cache delete error for key ${key}:`, error);
        }
    }
    /**
     * Delete multiple keys matching a pattern
     */
    async deletePattern(pattern) {
        try {
            const keys = await this.redis.keys(pattern);
            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
        }
        catch (error) {
            console.error(`Cache delete pattern error for ${pattern}:`, error);
        }
    }
    /**
     * Check if key exists
     */
    async exists(key) {
        try {
            const result = await this.redis.exists(key);
            return result === 1;
        }
        catch (error) {
            console.error(`Cache exists error for key ${key}:`, error);
            return false;
        }
    }
    /**
     * Get or set cache with factory function
     */
    async getOrSet(key, factory, ttl) {
        const cached = await this.get(key);
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
    async increment(key, by = 1) {
        try {
            return await this.redis.incrby(key, by);
        }
        catch (error) {
            console.error(`Cache increment error for key ${key}:`, error);
            return 0;
        }
    }
    /**
     * Set hash field
     */
    async hset(key, field, value) {
        try {
            await this.redis.hset(key, field, value);
        }
        catch (error) {
            console.error(`Cache hset error for key ${key}:`, error);
        }
    }
    /**
     * Get hash field
     */
    async hget(key, field) {
        try {
            return await this.redis.hget(key, field);
        }
        catch (error) {
            console.error(`Cache hget error for key ${key}:`, error);
            return null;
        }
    }
    /**
     * Get all hash fields
     */
    async hgetall(key) {
        try {
            const result = await this.redis.hgetall(key);
            return Object.keys(result).length > 0 ? result : null;
        }
        catch (error) {
            console.error(`Cache hgetall error for key ${key}:`, error);
            return null;
        }
    }
    /**
     * Add to sorted set
     */
    async zadd(key, score, member) {
        try {
            await this.redis.zadd(key, score, member);
        }
        catch (error) {
            console.error(`Cache zadd error for key ${key}:`, error);
        }
    }
    /**
     * Get top members from sorted set
     */
    async zrevrange(key, start, stop) {
        try {
            return await this.redis.zrevrange(key, start, stop);
        }
        catch (error) {
            console.error(`Cache zrevrange error for key ${key}:`, error);
            return [];
        }
    }
    /**
     * Flush all cache
     */
    async flush() {
        try {
            await this.redis.flushdb();
        }
        catch (error) {
            console.error('Cache flush error:', error);
        }
    }
    /**
     * Close Redis connection
     */
    async close() {
        await this.redis.quit();
    }
}
exports.CacheService = CacheService;
// Cache key generators
exports.CacheKeys = {
    user: (userId) => `user:${userId}`,
    venue: (venueId) => `venue:${venueId}`,
    city: (cityId) => `city:${cityId}`,
    cityVenues: (cityId) => `city:${cityId}:venues`,
    list: (listId) => `list:${listId}`,
    recommendations: (userId, cityId) => `recommendations:${userId}:${cityId}`,
    trending: (cityId) => `trending:${cityId}`,
    search: (query, filters) => `search:${query}:${filters}`,
    session: (sessionId) => `session:${sessionId}`,
};
//# sourceMappingURL=cache.service.js.map