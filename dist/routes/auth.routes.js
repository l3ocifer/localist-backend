"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const express_validator_1 = require("express-validator");
const database_1 = __importDefault(require("../config/database"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
router.post('/register', [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
    (0, express_validator_1.body)('first_name').trim().isLength({ min: 1, max: 100 }),
    (0, express_validator_1.body)('last_name').trim().isLength({ min: 1, max: 100 }),
    (0, express_validator_1.body)('phone').optional().isMobilePhone('any')
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { email, password, first_name, last_name, phone } = req.body;
    try {
        const existingUser = await database_1.default.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const hashedPassword = await bcryptjs_1.default.hash(password, 10);
        const newUser = await database_1.default.query(`INSERT INTO users (email, password_hash, first_name, last_name, phone) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, first_name, last_name`, [email, hashedPassword, first_name, last_name, phone]);
        const token = jsonwebtoken_1.default.sign({ userId: newUser.rows[0].id, email: newUser.rows[0].email }, JWT_SECRET, { expiresIn: '7d' });
        return res.status(201).json({
            user: newUser.rows[0],
            token
        });
    }
    catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ error: 'Failed to register user' });
    }
});
router.post('/login', [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('password').notEmpty()
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { email, password } = req.body;
    try {
        const user = await database_1.default.query('SELECT id, email, password_hash, first_name, last_name, is_premium FROM users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const validPassword = await bcryptjs_1.default.compare(password, user.rows[0].password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jsonwebtoken_1.default.sign({
            userId: user.rows[0].id,
            email: user.rows[0].email,
            isPremium: user.rows[0].is_premium
        }, JWT_SECRET, { expiresIn: '7d' });
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await database_1.default.query('INSERT INTO user_sessions (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)', [sessionId, user.rows[0].id, token, expiresAt]);
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
    }
    catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Failed to login' });
    }
});
router.post('/logout', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        await database_1.default.query('DELETE FROM user_sessions WHERE user_id = $1', [req.userId]);
        return res.json({ message: 'Logged out successfully' });
    }
    catch (error) {
        console.error('Logout error:', error);
        return res.status(500).json({ error: 'Failed to logout' });
    }
});
router.post('/refresh', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const token = jsonwebtoken_1.default.sign({ userId: req.userId, email: req.user.email }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token });
    }
    catch (error) {
        console.error('Token refresh error:', error);
        return res.status(500).json({ error: 'Failed to refresh token' });
    }
});
router.get('/me', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const user = await database_1.default.query('SELECT id, email, first_name, last_name, phone, preferences, is_premium FROM users WHERE id = $1', [req.userId]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({
            user: user.rows[0]
        });
    }
    catch (error) {
        console.error('Get user error:', error);
        return res.status(500).json({ error: 'Failed to get user info' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map