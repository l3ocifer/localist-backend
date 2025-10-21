import { Request, Response, NextFunction } from 'express';
/**
 * Enhanced rate limiting per user
 */
export declare const userRateLimit: () => (req: Request, res: Response, next: NextFunction) => Promise<void>;
/**
 * API key authentication for partners
 */
export declare const apiKeyAuth: () => (req: Request, res: Response, next: NextFunction) => Promise<void>;
/**
 * Request ID middleware for tracking
 */
export declare const requestId: () => (req: Request, res: Response, next: NextFunction) => void;
/**
 * IP whitelist/blacklist middleware
 */
export declare const ipFilter: (options?: {
    whitelist?: string[];
    blacklist?: string[];
}) => (req: Request, res: Response, next: NextFunction) => Promise<void>;
/**
 * SQL injection prevention middleware
 */
export declare const sqlInjectionPrevention: () => (req: Request, res: Response, next: NextFunction) => void;
/**
 * XSS prevention middleware
 */
export declare const xssPrevention: () => (req: Request, res: Response, next: NextFunction) => void;
/**
 * Security headers middleware
 */
export declare const securityHeaders: () => (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=security.middleware.d.ts.map