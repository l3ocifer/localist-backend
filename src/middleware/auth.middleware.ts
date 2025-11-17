import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database';

export interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, decoded: any) => {
    if (err) {
      res.status(403).json({ error: 'Invalid or expired token' });
      return;
    }
    
    req.userId = decoded.userId;
    req.user = decoded;
    next();
  });
};

export const optionalAuth = (req: AuthRequest, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, decoded: any) => {
    if (!err) {
      req.userId = decoded.userId;
      req.user = decoded;
    }
    next();
  });
};

/**
 * Admin authentication middleware
 * Requires valid JWT token AND admin role in database
 */
export const authenticateAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // First verify token
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      res.status(403).json({ error: 'Invalid or expired token' });
      return;
    }

    // Verify user exists and is admin
    const userResult = await pool.query(
      'SELECT id, email, is_admin FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      res.status(403).json({ error: 'User not found' });
      return;
    }

    const user = userResult.rows[0];
    
    if (!user.is_admin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    // Attach user info to request
    req.userId = user.id;
    req.user = {
      ...decoded,
      isAdmin: true,
      email: user.email
    };

    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication error' });
  }
};