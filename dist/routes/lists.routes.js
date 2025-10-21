"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = __importDefault(require("../config/database"));
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    const { featured, city, limit = 20, offset = 0 } = req.query;
    try {
        let query = `
      SELECT l.*, c.name as city_name 
      FROM lists l
      LEFT JOIN cities c ON l.city_id = c.id
      WHERE 1=1
    `;
        const params = [];
        let paramCount = 0;
        if (city) {
            paramCount++;
            query += ` AND l.city_id = $${paramCount}`;
            params.push(city);
        }
        if (featured === 'true') {
            query += ` AND l.is_featured = true`;
        }
        query += ` ORDER BY l.is_featured DESC, l.created_at DESC`;
        query += ` LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(limit, offset);
        const lists = await database_1.default.query(query, params);
        return res.json({
            lists: lists.rows,
            pagination: {
                limit: Number(limit),
                offset: Number(offset)
            }
        });
    }
    catch (error) {
        console.error('Get lists error:', error);
        return res.status(500).json({ error: 'Failed to fetch lists' });
    }
});
router.get('/:listId', async (req, res) => {
    const { listId } = req.params;
    try {
        const list = await database_1.default.query(`SELECT l.*, c.name as city_name 
       FROM lists l
       LEFT JOIN cities c ON l.city_id = c.id
       WHERE l.id = $1`, [listId]);
        if (list.rows.length === 0) {
            return res.status(404).json({ error: 'List not found' });
        }
        const venueIds = list.rows[0].venue_ids || [];
        let venues = [];
        if (venueIds.length > 0) {
            const venuesResult = await database_1.default.query(`SELECT id, name, category, cuisine, price_range, rating, image_url, address
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
        console.error('Get list error:', error);
        return res.status(500).json({ error: 'Failed to fetch list' });
    }
});
exports.default = router;
//# sourceMappingURL=lists.routes.js.map