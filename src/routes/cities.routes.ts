import { Router, Request, Response } from 'express';
import pool from '../config/database';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const cities = await pool.query(
      'SELECT id, name, state, country, description, image_url, timezone, coordinates FROM cities ORDER BY name'
    );
    
    return res.json({
      cities: cities.rows
    });
  } catch (error) {
    console.error('Get cities error:', error);
    return res.status(500).json({ error: 'Failed to fetch cities' });
  }
});

router.get('/:cityId', async (req: Request, res: Response) => {
  const { cityId } = req.params;
  
  try {
    const city = await pool.query(
      'SELECT id, name, state, country, description, image_url, timezone, coordinates FROM cities WHERE id = $1',
      [cityId]
    );
    
    if (city.rows.length === 0) {
      return res.status(404).json({ error: 'City not found' });
    }
    
    return res.json({
      city: city.rows[0]
    });
  } catch (error) {
    console.error('Get city error:', error);
    return res.status(500).json({ error: 'Failed to fetch city' });
  }
});

router.get('/:cityId/venues', async (req: Request, res: Response) => {
  const { cityId } = req.params;
  const { category, cuisine, price, limit = 50, offset = 0 } = req.query;
  
  try {
    let query = `
      SELECT id, name, category, cuisine, price_range, description, 
             address, phone, website, image_url, rating, coordinates, hours, features
      FROM venues 
      WHERE city_id = $1
    `;
    
    const params: any[] = [cityId];
    let paramCount = 1;
    
    if (category) {
      paramCount++;
      query += ` AND category = $${paramCount}`;
      params.push(category);
    }
    
    if (cuisine) {
      paramCount++;
      query += ` AND cuisine = $${paramCount}`;
      params.push(cuisine);
    }
    
    if (price) {
      paramCount++;
      query += ` AND price_range = $${paramCount}`;
      params.push(price);
    }
    
    query += ` ORDER BY rating DESC NULLS LAST, name`;
    query += ` LIMIT $${++paramCount} OFFSET $${++paramCount}`;
    params.push(limit, offset);
    
    const venues = await pool.query(query, params);
    
    return res.json({
      venues: venues.rows,
      pagination: {
        limit: Number(limit),
        offset: Number(offset),
        total: venues.rowCount
      }
    });
  } catch (error) {
    console.error('Get city venues error:', error);
    return res.status(500).json({ error: 'Failed to fetch venues' });
  }
});

router.get('/:cityId/lists', async (req: Request, res: Response) => {
  const { cityId } = req.params;
  const { featured, limit = 20, offset = 0 } = req.query;
  
  try {
    let query = `
      SELECT id, name, category, category_type, description, curator, is_featured, venue_ids, image_url
      FROM lists 
      WHERE city_id = $1
    `;
    
    const params: any[] = [cityId];
    let paramCount = 1;
    
    if (featured === 'true') {
      query += ` AND is_featured = true`;
    }
    
    query += ` ORDER BY is_featured DESC, created_at DESC`;
    query += ` LIMIT $${++paramCount} OFFSET $${++paramCount}`;
    params.push(limit, offset);
    
    const lists = await pool.query(query, params);
    
    return res.json({
      lists: lists.rows,
      pagination: {
        limit: Number(limit),
        offset: Number(offset)
      }
    });
  } catch (error) {
    console.error('Get city lists error:', error);
    return res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

export default router;