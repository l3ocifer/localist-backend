import { Router, Request, Response } from 'express';
import pool from '../config/database';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const { 
    q, 
    city, 
    category, 
    cuisine, 
    price, 
    rating,
    limit = 20, 
    offset = 0 
  } = req.query;
  
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
    
    const params: any[] = [searchTerm];
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
      params.push(parseFloat(rating as string));
    }
    
    query += ` ORDER BY v.rating DESC NULLS LAST, v.name`;
    query += ` LIMIT $${++paramCount} OFFSET $${++paramCount}`;
    params.push(limit, offset);
    
    const venues = await pool.query(query, params);
    
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
    const lists = await pool.query(listsQuery, listsParams);
    
    return res.json({
      venues: venues.rows,
      lists: lists.rows,
      pagination: {
        limit: Number(limit),
        offset: Number(offset),
        totalVenues: venues.rowCount
      }
    });
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: 'Failed to perform search' });
  }
});

export default router;