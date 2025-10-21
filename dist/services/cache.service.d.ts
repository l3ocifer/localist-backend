export declare class CacheService {
    private static instance;
    private redis;
    private defaultTTL;
    private constructor();
    static getInstance(): CacheService;
    /**
     * Get value from cache
     */
    get<T>(key: string): Promise<T | null>;
    /**
     * Set value in cache with optional TTL
     */
    set<T>(key: string, value: T, ttl?: number): Promise<void>;
    /**
     * Delete value from cache
     */
    delete(key: string): Promise<void>;
    /**
     * Delete multiple keys matching a pattern
     */
    deletePattern(pattern: string): Promise<void>;
    /**
     * Check if key exists
     */
    exists(key: string): Promise<boolean>;
    /**
     * Get or set cache with factory function
     */
    getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T>;
    /**
     * Increment a counter
     */
    increment(key: string, by?: number): Promise<number>;
    /**
     * Set hash field
     */
    hset(key: string, field: string, value: string): Promise<void>;
    /**
     * Get hash field
     */
    hget(key: string, field: string): Promise<string | null>;
    /**
     * Get all hash fields
     */
    hgetall(key: string): Promise<Record<string, string> | null>;
    /**
     * Add to sorted set
     */
    zadd(key: string, score: number, member: string): Promise<void>;
    /**
     * Get top members from sorted set
     */
    zrevrange(key: string, start: number, stop: number): Promise<string[]>;
    /**
     * Flush all cache
     */
    flush(): Promise<void>;
    /**
     * Close Redis connection
     */
    close(): Promise<void>;
}
export declare const CacheKeys: {
    user: (userId: string) => string;
    venue: (venueId: string) => string;
    city: (cityId: string) => string;
    cityVenues: (cityId: string) => string;
    list: (listId: string) => string;
    recommendations: (userId: string, cityId: string) => string;
    trending: (cityId: string) => string;
    search: (query: string, filters: string) => string;
    session: (sessionId: string) => string;
};
//# sourceMappingURL=cache.service.d.ts.map