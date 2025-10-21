export declare const config: {
    env: string;
    port: number;
    database: {
        host: string;
        port: number;
        name: string;
        user: string;
        password: string;
        maxConnections: number;
        idleTimeoutMillis: number;
        connectionTimeoutMillis: number;
    };
    jwt: {
        secret: string;
        expiresIn: string;
    };
    security: {
        bcryptRounds: number;
        rateLimitWindowMs: number;
        rateLimitMaxRequests: number;
    };
    cors: {
        origin: string;
        credentials: boolean;
    };
    redis: {
        host: string;
        port: number;
        ttl: number;
    };
    isDevelopment: boolean;
    isProduction: boolean;
    isTest: boolean;
};
export default config;
//# sourceMappingURL=index.d.ts.map