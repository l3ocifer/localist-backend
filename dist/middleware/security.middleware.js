"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityHeaders = exports.xssPrevention = exports.sqlInjectionPrevention = exports.ipFilter = exports.requestId = exports.apiKeyAuth = exports.userRateLimit = void 0;
const cache_service_1 = require("../services/cache.service");
const logger_service_1 = __importDefault(require("../services/logger.service"));
const crypto_1 = __importDefault(require("crypto"));
const cache = cache_service_1.CacheService.getInstance();
/**
 * Enhanced rate limiting per user
 */
const userRateLimit = () => {
    return async (req, res, next) => {
        const userId = req.userId;
        const ip = req.ip || '';
        const key = userId ? `rate:user:${userId}` : `rate:ip:${ip}`;
        try {
            const requests = await cache.increment(key);
            if (requests === 1) {
                // Set expiry on first request
                await cache.set(key, requests, 900); // 15 minutes
            }
            const limit = userId ? 200 : 100; // Higher limit for authenticated users
            if (requests > limit) {
                logger_service_1.default.warn('Rate limit exceeded', { userId, ip, requests });
                res.status(429).json({
                    error: 'Too many requests, please try again later'
                });
                return;
            }
            // Add rate limit headers
            res.setHeader('X-RateLimit-Limit', limit);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - requests));
            res.setHeader('X-RateLimit-Reset', new Date(Date.now() + 900000).toISOString());
            next();
        }
        catch (error) {
            logger_service_1.default.error('Rate limit check failed', error);
            next(); // Continue on error
        }
    };
};
exports.userRateLimit = userRateLimit;
/**
 * API key authentication for partners
 */
const apiKeyAuth = () => {
    return async (req, res, next) => {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) {
            next(); // No API key provided, continue to other auth methods
            return;
        }
        try {
            const hashedKey = crypto_1.default.createHash('sha256').update(apiKey).digest('hex');
            const partner = await cache.get(`apikey:${hashedKey}`);
            if (partner) {
                req.partner = partner;
                req.isApiKeyAuth = true;
                next();
            }
            else {
                res.status(401).json({ error: 'Invalid API key' });
            }
        }
        catch (error) {
            logger_service_1.default.error('API key validation failed', error);
            res.status(500).json({ error: 'Authentication error' });
        }
    };
};
exports.apiKeyAuth = apiKeyAuth;
/**
 * Request ID middleware for tracking
 */
const requestId = () => {
    return (req, res, next) => {
        const id = req.headers['x-request-id'] || crypto_1.default.randomUUID();
        req.requestId = id;
        res.setHeader('X-Request-Id', id);
        next();
    };
};
exports.requestId = requestId;
/**
 * IP whitelist/blacklist middleware
 */
const ipFilter = (options) => {
    const whitelist = new Set(options?.whitelist || []);
    const blacklist = new Set(options?.blacklist || []);
    return async (req, res, next) => {
        const ip = req.ip || '';
        // Check blacklist from cache (dynamic blocking)
        const isBlocked = await cache.get(`blocked:ip:${ip}`);
        if (isBlocked || blacklist.has(ip)) {
            logger_service_1.default.warn('Blocked IP attempted access', { ip });
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        // Check whitelist if configured
        if (whitelist.size > 0 && !whitelist.has(ip)) {
            logger_service_1.default.warn('Non-whitelisted IP attempted access', { ip });
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        next();
    };
};
exports.ipFilter = ipFilter;
/**
 * SQL injection prevention middleware
 */
const sqlInjectionPrevention = () => {
    const sqlPatterns = [
        /(\b)(DELETE|DROP|EXEC(UTE)?|INSERT|SELECT|UNION|UPDATE)(\b)/gi,
        /--/g,
        /\/\*/g,
        /\*\//g,
        /;/g,
        /'/g,
        /"/g,
        /`/g
    ];
    return (req, res, next) => {
        const checkValue = (value) => {
            if (typeof value !== 'string')
                return true;
            for (const pattern of sqlPatterns) {
                if (pattern.test(value)) {
                    logger_service_1.default.warn('Potential SQL injection attempt', {
                        ip: req.ip,
                        path: req.path,
                        value: value.substring(0, 100)
                    });
                    return false;
                }
            }
            return true;
        };
        // Check query parameters
        for (const key in req.query) {
            if (!checkValue(req.query[key])) {
                res.status(400).json({ error: 'Invalid input detected' });
                return;
            }
        }
        // Check body parameters (excluding certain fields like passwords)
        const skipFields = ['password', 'description', 'content'];
        for (const key in req.body) {
            if (!skipFields.includes(key) && !checkValue(req.body[key])) {
                res.status(400).json({ error: 'Invalid input detected' });
                return;
            }
        }
        next();
    };
};
exports.sqlInjectionPrevention = sqlInjectionPrevention;
/**
 * XSS prevention middleware
 */
const xssPrevention = () => {
    const xssPatterns = [
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /<img[^>]+src[\\s]*=[\\s]*["\']javascript:/gi
    ];
    return (req, res, next) => {
        const checkValue = (value) => {
            if (typeof value !== 'string')
                return true;
            for (const pattern of xssPatterns) {
                if (pattern.test(value)) {
                    logger_service_1.default.warn('Potential XSS attempt', {
                        ip: req.ip,
                        path: req.path,
                        value: value.substring(0, 100)
                    });
                    return false;
                }
            }
            return true;
        };
        // Check body parameters
        for (const key in req.body) {
            if (!checkValue(req.body[key])) {
                res.status(400).json({ error: 'Invalid input detected' });
                return;
            }
        }
        next();
    };
};
exports.xssPrevention = xssPrevention;
/**
 * Security headers middleware
 */
const securityHeaders = () => {
    return (_req, res, next) => {
        // Prevent clickjacking
        res.setHeader('X-Frame-Options', 'DENY');
        // Prevent MIME type sniffing
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // Enable XSS protection
        res.setHeader('X-XSS-Protection', '1; mode=block');
        // Referrer policy
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        // Content Security Policy
        res.setHeader('Content-Security-Policy', "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: https:; " +
            "font-src 'self' data:; " +
            "connect-src 'self' https://api.discoverlocal.ai wss://api.discoverlocal.ai");
        // Strict Transport Security (HSTS)
        if (process.env.NODE_ENV === 'production') {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        }
        next();
    };
};
exports.securityHeaders = securityHeaders;
//# sourceMappingURL=security.middleware.js.map