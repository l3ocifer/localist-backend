import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import pool from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  body('first_name').trim().isLength({ min: 1, max: 100 }),
  body('last_name').trim().isLength({ min: 1, max: 100 }),
  body('phone').optional().isMobilePhone('any')
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password, first_name, last_name, phone } = req.body;

  try {
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, first_name, last_name`,
      [email, hashedPassword, first_name, last_name, phone]
    );

    const token = jwt.sign(
      { userId: newUser.rows[0].id, email: newUser.rows[0].email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      user: newUser.rows[0],
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Failed to register user' });
  }
});

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const user = await pool.query(
      'SELECT id, email, password_hash, first_name, last_name, is_premium FROM users WHERE email = $1',
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.rows[0].password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { 
        userId: user.rows[0].id, 
        email: user.rows[0].email,
        isPremium: user.rows[0].is_premium
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      'INSERT INTO user_sessions (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)',
      [sessionId, user.rows[0].id, token, expiresAt]
    );

    return res.json({
      user: {
        id: user.rows[0].id,
        email: user.rows[0].email,
        firstName: user.rows[0].first_name,
        lastName: user.rows[0].last_name,
        isPremium: user.rows[0].is_premium
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Failed to login' });
  }
});

router.post('/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await pool.query(
      'DELETE FROM user_sessions WHERE user_id = $1',
      [req.userId]
    );
    return res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Failed to logout' });
  }
});

router.post('/refresh', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const token = jwt.sign(
      { userId: req.userId, email: req.user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ token });
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({ error: 'Failed to refresh token' });
  }
});

router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await pool.query(
      'SELECT id, email, first_name, last_name, phone, preferences, is_premium FROM users WHERE id = $1',
      [req.userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      user: user.rows[0]
    });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({ error: 'Failed to get user info' });
  }
});

export default router;