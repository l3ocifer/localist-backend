import { Router, Request, Response } from 'express';
import pool from '../config/database';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const { featured, city, limit = 20, offset = 0 } = req.query;
  
  try {
    let query = `
      SELECT l.*, c.name as city_name 
      FROM lists l
      LEFT JOIN cities c ON l.city_id = c.id
      WHERE 1=1
    `;
    
    const params: any[] = [];
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
    
    const lists = await pool.query(query, params);
    
    return res.json({
      lists: lists.rows,
      pagination: {
        limit: Number(limit),
        offset: Number(offset)
      }
    });
  } catch (error) {
    console.error('Get lists error:', error);
    return res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

// Public list sharing endpoint (no auth required) - must be before /:listId
router.get('/share/:shareToken', async (req: Request, res: Response) => {
  const { shareToken } = req.params;
  
  try {
    const list = await pool.query(
      `SELECT ul.*, u.first_name, u.last_name, u.email
       FROM user_lists ul
       JOIN users u ON ul.user_id = u.id
       WHERE ul.share_token = $1 AND ul.is_public = true`,
      [shareToken]
    );
    
    if (list.rows.length === 0) {
      return res.status(404).json({ error: 'List not found or not publicly shared' });
    }
    
    // Increment view count
    await pool.query(
      'UPDATE user_lists SET view_count = view_count + 1 WHERE id = $1',
      [list.rows[0].id]
    );
    
    // Track view
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    await pool.query(
      'INSERT INTO list_views (list_id, ip_address, user_agent) VALUES ($1, $2, $3)',
      [list.rows[0].id, ipAddress, userAgent]
    );
    
    const venueIds = list.rows[0].venue_ids || [];
    let venues = [];
    
    if (venueIds.length > 0) {
      const venuesResult = await pool.query(
        `SELECT id, name, category, cuisine, price_range, rating, image_url, address
         FROM venues 
         WHERE id = ANY($1::text[])`,
        [venueIds]
      );
      venues = venuesResult.rows;
    }
    
    return res.json({
      list: {
        ...list.rows[0],
        venues,
        creator: {
          firstName: list.rows[0].first_name,
          lastName: list.rows[0].last_name,
        }
      }
    });
  } catch (error) {
    console.error('Get shared list error:', error);
    return res.status(500).json({ error: 'Failed to fetch shared list' });
  }
});

router.get('/:listId', async (req: Request, res: Response) => {
  const { listId } = req.params;
  
  try {
    const list = await pool.query(
      `SELECT l.*, c.name as city_name 
       FROM lists l
       LEFT JOIN cities c ON l.city_id = c.id
       WHERE l.id = $1`,
      [listId]
    );
    
    if (list.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }
    
    const venueIds = list.rows[0].venue_ids || [];
    let venues = [];
    
    if (venueIds.length > 0) {
      const venuesResult = await pool.query(
        `SELECT id, name, category, cuisine, price_range, rating, image_url, address
         FROM venues 
         WHERE id = ANY($1::text[])`,
        [venueIds]
      );
      venues = venuesResult.rows;
    }
    
    return res.json({
      list: {
        ...list.rows[0],
        venues
      }
    });
  } catch (error) {
    console.error('Get list error:', error);
    return res.status(500).json({ error: 'Failed to fetch list' });
  }
});

export default router;