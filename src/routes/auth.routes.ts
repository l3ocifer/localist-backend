import { Router, Response } from 'express';
import pool from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';
import logger from '../services/logger.service';

const router = Router();

/**
 * Auth Routes - Logto Integration
 * 
 * All authentication (login/register/password reset) is handled by Logto.
 * These routes only handle user info and session management.
 * 
 * Logto Sign-in: http://localhost:3301 (configure in frontend)
 * Logto Admin: http://localhost:3302
 */

/**
 * GET /auth/me - Get current user info
 * Requires valid Logto access token
 */
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await pool.query(
      `SELECT id, email, first_name, last_name, phone, preferences, 
              is_premium, is_admin, avatar_url, created_at, last_login
       FROM users WHERE id = $1`,
      [req.userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = user.rows[0];
    return res.json({
      id: userData.id,
      email: userData.email,
      firstName: userData.first_name,
      lastName: userData.last_name,
      phone: userData.phone,
      preferences: userData.preferences,
      isPremium: userData.is_premium,
      isAdmin: userData.is_admin,
      avatarUrl: userData.avatar_url,
      createdAt: userData.created_at,
      lastLogin: userData.last_login,
    });
  } catch (error) {
    logger.error('Get user error:', error);
    return res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * POST /auth/logout - Clear server-side session data
 * Note: Actual logout is handled by Logto, this just cleans up local sessions
 */
router.post('/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Clean up any local session data
    await pool.query(
      'DELETE FROM user_sessions WHERE user_id = $1',
      [req.userId]
    );
    
    logger.info('User logged out', { userId: req.userId });
    return res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error:', error);
    return res.status(500).json({ error: 'Failed to logout' });
  }
});

/**
 * GET /auth/config - Get Logto configuration for frontend
 * Public endpoint - no auth required
 */
router.get('/config', (_req, res: Response) => {
  res.json({
    logto: {
      endpoint: process.env.LOGTO_ENDPOINT || 'http://localhost:3301',
      // App ID should be configured in Logto admin console and set via env
      appId: process.env.LOGTO_APP_ID || '',
    }
  });
});

/**
 * POST /auth/sync - Sync user profile from Logto claims
 * Called after Logto authentication to ensure user exists in local DB
 */
router.post('/sync', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // User is already synced by the authenticateToken middleware
    // Just return the current user data
    const user = await pool.query(
      `SELECT id, email, first_name, last_name, phone, preferences, 
              is_premium, is_admin, avatar_url, created_at, last_login
       FROM users WHERE id = $1`,
      [req.userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = user.rows[0];
    logger.info('User synced from Logto', { userId: req.userId, email: userData.email });
    
    return res.json({
      id: userData.id,
      email: userData.email,
      firstName: userData.first_name,
      lastName: userData.last_name,
      phone: userData.phone,
      preferences: userData.preferences,
      isPremium: userData.is_premium,
      isAdmin: userData.is_admin,
      avatarUrl: userData.avatar_url,
      createdAt: userData.created_at,
      lastLogin: userData.last_login,
    });
  } catch (error) {
    logger.error('User sync error:', error);
    return res.status(500).json({ error: 'Failed to sync user' });
  }
});

export default router;
