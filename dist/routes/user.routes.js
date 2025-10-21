"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const database_1 = __importDefault(require("../config/database"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticateToken);
router.get('/lists', async (req, res) => {
    try {
        const lists = await database_1.default.query(`SELECT id, name, description, venue_ids, is_public, created_at, updated_at
       FROM user_lists 
       WHERE user_id = $1
       ORDER BY updated_at DESC`, [req.userId]);
        return res.json({
            lists: lists.rows
        });
    }
    catch (error) {
        console.error('Get user lists error:', error);
        return res.status(500).json({ error: 'Failed to fetch lists' });
    }
});
router.post('/lists', [
    (0, express_validator_1.body)('name').trim().isLength({ min: 1, max: 200 }),
    (0, express_validator_1.body)('description').optional().trim(),
    (0, express_validator_1.body)('is_public').optional().isBoolean()
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { name, description, is_public = false } = req.body;
    const listId = `ul_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    try {
        const newList = await database_1.default.query(`INSERT INTO user_lists (id, user_id, name, description, is_public)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, is_public, venue_ids, created_at`, [listId, req.userId, name, description, is_public]);
        return res.status(201).json({
            list: newList.rows[0]
        });
    }
    catch (error) {
        console.error('Create user list error:', error);
        return res.status(500).json({ error: 'Failed to create list' });
    }
});
router.get('/lists/:listId', async (req, res) => {
    const { listId } = req.params;
    try {
        const list = await database_1.default.query(`SELECT id, name, description, venue_ids, is_public, created_at, updated_at
       FROM user_lists 
       WHERE id = $1 AND user_id = $2`, [listId, req.userId]);
        if (list.rows.length === 0) {
            return res.status(404).json({ error: 'List not found' });
        }
        const venueIds = list.rows[0].venue_ids || [];
        let venues = [];
        if (venueIds.length > 0) {
            const venuesResult = await database_1.default.query(`SELECT id, name, category, cuisine, price_range, rating, image_url
         FROM venues 
         WHERE id = ANY($1::text[])`, [venueIds]);
            venues = venuesResult.rows;
        }
        return res.json({
            list: {
                ...list.rows[0],
                venues
            }
        });
    }
    catch (error) {
        console.error('Get user list error:', error);
        return res.status(500).json({ error: 'Failed to fetch list' });
    }
});
router.put('/lists/:listId', [
    (0, express_validator_1.body)('name').optional().trim().isLength({ min: 1, max: 200 }),
    (0, express_validator_1.body)('description').optional().trim(),
    (0, express_validator_1.body)('is_public').optional().isBoolean(),
    (0, express_validator_1.body)('venue_ids').optional().isArray()
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { listId } = req.params;
    const { name, description, is_public, venue_ids } = req.body;
    try {
        let updateFields = [];
        let updateValues = [];
        let paramCount = 0;
        if (name !== undefined) {
            updateFields.push(`name = $${++paramCount}`);
            updateValues.push(name);
        }
        if (description !== undefined) {
            updateFields.push(`description = $${++paramCount}`);
            updateValues.push(description);
        }
        if (is_public !== undefined) {
            updateFields.push(`is_public = $${++paramCount}`);
            updateValues.push(is_public);
        }
        if (venue_ids !== undefined) {
            updateFields.push(`venue_ids = $${++paramCount}`);
            updateValues.push(venue_ids);
        }
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        updateValues.push(listId, req.userId);
        const updateQuery = `
      UPDATE user_lists 
      SET ${updateFields.join(', ')}, updated_at = NOW()
      WHERE id = $${++paramCount} AND user_id = $${++paramCount}
      RETURNING id, name, description, is_public, venue_ids, updated_at
    `;
        const result = await database_1.default.query(updateQuery, updateValues);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'List not found' });
        }
        return res.json({
            list: result.rows[0]
        });
    }
    catch (error) {
        console.error('Update user list error:', error);
        return res.status(500).json({ error: 'Failed to update list' });
    }
});
router.delete('/lists/:listId', async (req, res) => {
    const { listId } = req.params;
    try {
        const result = await database_1.default.query('DELETE FROM user_lists WHERE id = $1 AND user_id = $2 RETURNING id', [listId, req.userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'List not found' });
        }
        return res.json({ message: 'List deleted successfully' });
    }
    catch (error) {
        console.error('Delete user list error:', error);
        return res.status(500).json({ error: 'Failed to delete list' });
    }
});
router.get('/favorites', async (req, res) => {
    try {
        const favorites = await database_1.default.query(`SELECT v.id, v.name, v.category, v.cuisine, v.price_range, v.rating, v.image_url, v.address
       FROM user_favorites uf
       JOIN venues v ON uf.venue_id = v.id
       WHERE uf.user_id = $1
       ORDER BY uf.created_at DESC`, [req.userId]);
        return res.json({
            favorites: favorites.rows
        });
    }
    catch (error) {
        console.error('Get favorites error:', error);
        return res.status(500).json({ error: 'Failed to fetch favorites' });
    }
});
router.post('/favorites/:venueId', async (req, res) => {
    const { venueId } = req.params;
    try {
        await database_1.default.query('INSERT INTO user_favorites (user_id, venue_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.userId, venueId]);
        return res.status(201).json({ message: 'Added to favorites' });
    }
    catch (error) {
        console.error('Add favorite error:', error);
        return res.status(500).json({ error: 'Failed to add favorite' });
    }
});
router.delete('/favorites/:venueId', async (req, res) => {
    const { venueId } = req.params;
    try {
        await database_1.default.query('DELETE FROM user_favorites WHERE user_id = $1 AND venue_id = $2', [req.userId, venueId]);
        return res.json({ message: 'Removed from favorites' });
    }
    catch (error) {
        console.error('Remove favorite error:', error);
        return res.status(500).json({ error: 'Failed to remove favorite' });
    }
});
router.get('/profile', async (req, res) => {
    try {
        const user = await database_1.default.query('SELECT id, email, first_name, last_name, phone, preferences, is_premium FROM users WHERE id = $1', [req.userId]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({
            profile: user.rows[0]
        });
    }
    catch (error) {
        console.error('Get profile error:', error);
        return res.status(500).json({ error: 'Failed to fetch profile' });
    }
});
router.put('/profile', [
    (0, express_validator_1.body)('first_name').optional().trim().isLength({ min: 1, max: 100 }),
    (0, express_validator_1.body)('last_name').optional().trim().isLength({ min: 1, max: 100 }),
    (0, express_validator_1.body)('phone').optional().isMobilePhone('any')
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { first_name, last_name, phone } = req.body;
    try {
        const updateFields = [];
        const updateValues = [];
        let paramCount = 0;
        if (first_name !== undefined) {
            updateFields.push(`first_name = $${++paramCount}`);
            updateValues.push(first_name);
        }
        if (last_name !== undefined) {
            updateFields.push(`last_name = $${++paramCount}`);
            updateValues.push(last_name);
        }
        if (phone !== undefined) {
            updateFields.push(`phone = $${++paramCount}`);
            updateValues.push(phone);
        }
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        updateValues.push(req.userId);
        const result = await database_1.default.query(`UPDATE users 
       SET ${updateFields.join(', ')}, updated_at = NOW()
       WHERE id = $${++paramCount}
       RETURNING id, email, first_name, last_name, phone`, updateValues);
        return res.json({
            profile: result.rows[0]
        });
    }
    catch (error) {
        console.error('Update profile error:', error);
        return res.status(500).json({ error: 'Failed to update profile' });
    }
});
router.put('/preferences', [
    (0, express_validator_1.body)('preferences').isObject()
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { preferences } = req.body;
    try {
        await database_1.default.query('UPDATE users SET preferences = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(preferences), req.userId]);
        return res.json({ message: 'Preferences updated successfully' });
    }
    catch (error) {
        console.error('Update preferences error:', error);
        return res.status(500).json({ error: 'Failed to update preferences' });
    }
});
exports.default = router;
//# sourceMappingURL=user.routes.js.map