import { Request, Response, NextFunction } from 'express';
import { CacheService } from '../services/cache.service';
import logger from '../services/logger.service';
import crypto from 'crypto';

const cache = CacheService.getInstance();

/**
 * Enhanced rate limiting per user
 */
export const userRateLimit = (): (req: Request, res: Response, next: NextFunction) => Promise<void> => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = (req as any).userId;
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
        logger.warn('Rate limit exceeded', { userId, ip, requests });
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
    } catch (error) {
      logger.error('Rate limit check failed', error);
      next(); // Continue on error
    }
  };
};

/**
 * API key authentication for partners
 */
export const apiKeyAuth = (): (req: Request, res: Response, next: NextFunction) => Promise<void> => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const apiKey = req.headers['x-api-key'] as string;
    
    if (!apiKey) {
      next(); // No API key provided, continue to other auth methods
      return;
    }
    
    try {
      const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
      const partner = await cache.get(`apikey:${hashedKey}`);
      
      if (partner) {
        (req as any).partner = partner;
        (req as any).isApiKeyAuth = true;
        next();
      } else {
        res.status(401).json({ error: 'Invalid API key' });
      }
    } catch (error) {
      logger.error('API key validation failed', error);
      res.status(500).json({ error: 'Authentication error' });
    }
  };
};

/**
 * Request ID middleware for tracking
 */
export const requestId = (): (req: Request, res: Response, next: NextFunction) => void => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = req.headers['x-request-id'] as string || crypto.randomUUID();
    (req as any).requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
};

/**
 * IP whitelist/blacklist middleware
 */
export const ipFilter = (options?: { whitelist?: string[]; blacklist?: string[] }): (req: Request, res: Response, next: NextFunction) => Promise<void> => {
  const whitelist = new Set(options?.whitelist || []);
  const blacklist = new Set(options?.blacklist || []);
  
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip || '';
    
    // Check blacklist from cache (dynamic blocking)
    const isBlocked = await cache.get(`blocked:ip:${ip}`);
    if (isBlocked || blacklist.has(ip)) {
      logger.warn('Blocked IP attempted access', { ip });
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    
    // Check whitelist if configured
    if (whitelist.size > 0 && !whitelist.has(ip)) {
      logger.warn('Non-whitelisted IP attempted access', { ip });
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    
    next();
  };
};

/**
 * SQL injection prevention middleware
 */
export const sqlInjectionPrevention = (): (req: Request, res: Response, next: NextFunction) => void => {
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
  
  return (req: Request, res: Response, next: NextFunction): void => {
    const checkValue = (value: any): boolean => {
      if (typeof value !== 'string') return true;
      
      for (const pattern of sqlPatterns) {
        if (pattern.test(value)) {
          logger.warn('Potential SQL injection attempt', {
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

/**
 * XSS prevention middleware
 */
export const xssPrevention = (): (req: Request, res: Response, next: NextFunction) => void => {
  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<img[^>]+src[\\s]*=[\\s]*["\']javascript:/gi
  ];
  
  return (req: Request, res: Response, next: NextFunction): void => {
    const checkValue = (value: any): boolean => {
      if (typeof value !== 'string') return true;
      
      for (const pattern of xssPatterns) {
        if (pattern.test(value)) {
          logger.warn('Potential XSS attempt', {
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

/**
 * Security headers middleware
 */
export const securityHeaders = (): (req: Request, res: Response, next: NextFunction) => void => {
  return (_req: Request, res: Response, next: NextFunction): void => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Content Security Policy
    res.setHeader('Content-Security-Policy', 
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "font-src 'self' data:; " +
      "connect-src 'self' https://api.discoverlocal.ai wss://api.discoverlocal.ai"
    );
    
    // Strict Transport Security (HSTS)
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    next();
  };
};