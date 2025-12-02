import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import config from '../config';

/**
 * Logto Authentication Middleware
 * All authentication is now handled via Logto OIDC
 */

export interface LogtoUserInfo {
  sub: string;
  email?: string;
  name?: string;
  roles?: string[];
  isAdmin?: boolean;
  isPremium?: boolean;
}

export interface AuthRequest extends Request {
  userId?: string;
  logtoSub?: string;
  logtoUser?: LogtoUserInfo;
}

// Cache for JWKS
let jwksCache: { keys: any[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL = 3600000; // 1 hour

/**
 * Fetch JWKS from Logto
 */
async function fetchJWKS(): Promise<any[]> {
  const now = Date.now();
  
  if (jwksCache && (now - jwksCache.fetchedAt) < JWKS_CACHE_TTL) {
    return jwksCache.keys;
  }

  try {
    const jwksUrl = `${config.logto.issuer}/.well-known/jwks.json`;
    const response = await fetch(jwksUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKS: ${response.status}`);
    }
    const data = await response.json() as { keys: any[] };
    jwksCache = { keys: data.keys, fetchedAt: now };
    return data.keys;
  } catch (error) {
    console.error('Error fetching JWKS:', error);
    if (jwksCache) {
      return jwksCache.keys;
    }
    throw error;
  }
}

/**
 * Convert JWK to PEM format
 */
function jwkToPem(jwk: any): string {
  const crypto = require('crypto');
  const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return keyObject.export({ type: 'spki', format: 'pem' }) as string;
}

/**
 * Verify Logto JWT token
 */
async function verifyLogtoToken(token: string): Promise<any> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new Error('Invalid token format');
  }

  const { header } = decoded;
  const kid = header.kid;

  const keys = await fetchJWKS();
  const key = keys.find(k => k.kid === kid);
  
  if (!key) {
    throw new Error('No matching key found in JWKS');
  }

  const publicKey = jwkToPem(key);

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      publicKey,
      {
        algorithms: ['RS256', 'ES256', 'ES384'],
        issuer: config.logto.issuer,
        audience: config.logto.audience || undefined,
      },
      (err, decoded) => {
        if (err) reject(err);
        else resolve(decoded);
      }
    );
  });
}

/**
 * Sync Logto user with local database
 */
async function syncLogtoUser(claims: any): Promise<any> {
  const { sub, email, name, picture } = claims;
  
  // Try to find existing user by logto_sub
  let result = await pool.query(
    'SELECT id, email, first_name, last_name, is_premium, is_admin FROM users WHERE logto_sub = $1',
    [sub]
  );

  if (result.rows.length > 0) {
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE logto_sub = $1',
      [sub]
    );
    return result.rows[0];
  }

  // Try to find by email (for migration)
  if (email) {
    result = await pool.query(
      'SELECT id, email, first_name, last_name, is_premium, is_admin FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length > 0) {
      await pool.query(
        'UPDATE users SET logto_sub = $1, last_login = NOW() WHERE email = $2',
        [sub, email]
      );
      return result.rows[0];
    }
  }

  // Create new user
  const firstName = name?.split(' ')[0] || '';
  const lastName = name?.split(' ').slice(1).join(' ') || '';

  const insertResult = await pool.query(
    `INSERT INTO users (email, first_name, last_name, logto_sub, avatar_url, created_at, updated_at, last_login)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
     RETURNING id, email, first_name, last_name, is_premium, is_admin`,
    [email || `user_${sub}@logto.local`, firstName, lastName, sub, picture]
  );

  return insertResult.rows[0];
}

/**
 * Main authentication middleware
 * Validates Logto JWTs and syncs user with local database
 */
export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const claims = await verifyLogtoToken(token);
    const localUser = await syncLogtoUser(claims);
    
    req.logtoSub = claims.sub;
    req.userId = localUser.id;
    req.logtoUser = {
      sub: claims.sub,
      email: localUser.email,
      name: `${localUser.first_name} ${localUser.last_name}`.trim(),
      roles: claims.roles || [],
      isAdmin: localUser.is_admin || claims.roles?.includes('admin'),
      isPremium: localUser.is_premium,
    };

    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Optional authentication middleware
 */
export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    const claims = await verifyLogtoToken(token);
    const localUser = await syncLogtoUser(claims);
    
    req.logtoSub = claims.sub;
    req.userId = localUser.id;
    req.logtoUser = {
      sub: claims.sub,
      email: localUser.email,
      name: `${localUser.first_name} ${localUser.last_name}`.trim(),
      roles: claims.roles || [],
      isAdmin: localUser.is_admin || claims.roles?.includes('admin'),
      isPremium: localUser.is_premium,
    };
  } catch (error) {
    // Ignore errors for optional auth
  }

  next();
};

/**
 * Admin authentication middleware
 */
export const authenticateAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const claims = await verifyLogtoToken(token);
    const localUser = await syncLogtoUser(claims);
    
    const isAdmin = localUser.is_admin || claims.roles?.includes('admin');
    
    if (!isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    req.logtoSub = claims.sub;
    req.userId = localUser.id;
    req.logtoUser = {
      sub: claims.sub,
      email: localUser.email,
      name: `${localUser.first_name} ${localUser.last_name}`.trim(),
      roles: claims.roles || [],
      isAdmin: true,
      isPremium: localUser.is_premium,
    };

    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
