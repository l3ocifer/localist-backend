"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = __importDefault(require("../config/database"));
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    const { q, city, category, cuisine, price, rating, limit = 20, offset = 0 } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    const searchTerm = `%${q.trim().toLowerCase()}%`;
    try {
        let query = `
      SELECT v.*, c.name as city_name, c.state
      FROM venues v
      LEFT JOIN cities c ON v.city_id = c.id
      WHERE (LOWER(v.name) LIKE $1 OR LOWER(v.description) LIKE $1 OR LOWER(v.cuisine) LIKE $1)
    `;
        const params = [searchTerm];
        let paramCount = 1;
        if (city) {
            paramCount++;
            query += ` AND v.city_id = $${paramCount}`;
            params.push(city);
        }
        if (category) {
            paramCount++;
            query += ` AND v.category = $${paramCount}`;
            params.push(category);
        }
        if (cuisine) {
            paramCount++;
            query += ` AND v.cuisine = $${paramCount}`;
            params.push(cuisine);
        }
        if (price) {
            paramCount++;
            query += ` AND v.price_range = $${paramCount}`;
            params.push(price);
        }
        if (rating) {
            paramCount++;
            query += ` AND v.rating >= $${paramCount}`;
            params.push(parseFloat(rating));
        }
        query += ` ORDER BY v.rating DESC NULLS LAST, v.name`;
        query += ` LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(limit, offset);
        const venues = await database_1.default.query(query, params);
        const listsQuery = `
      SELECT l.*, c.name as city_name
      FROM lists l
      LEFT JOIN cities c ON l.city_id = c.id
      WHERE LOWER(l.name) LIKE $1 OR LOWER(l.description) LIKE $1
      ${city ? `AND l.city_id = $2` : ''}
      ORDER BY l.is_featured DESC, l.created_at DESC
      LIMIT 5
    `;
        const listsParams = city ? [searchTerm, city] : [searchTerm];
        const lists = await database_1.default.query(listsQuery, listsParams);
        return res.json({
            venues: venues.rows,
            lists: lists.rows,
            pagination: {
                limit: Number(limit),
                offset: Number(offset),
                totalVenues: venues.rowCount
            }
        });
    }
    catch (error) {
        console.error('Search error:', error);
        return res.status(500).json({ error: 'Failed to perform search' });
    }
});
exports.default = router;
//# sourceMappingURL=search.routes.js.map