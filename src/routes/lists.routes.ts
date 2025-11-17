import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { TrendingService } from '../services/trending.service';

const router = Router();
const trendingService = TrendingService.getInstance();

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

// Trending lists endpoint
router.get('/trending', async (req: Request, res: Response) => {
  const { city, limit = 10 } = req.query;
  
  try {
    const limitNum = Math.min(Math.max(Number(limit) || 10, 1), 50); // Clamp between 1 and 50
    const trendingLists = await trendingService.getTrendingLists(
      city as string | undefined,
      limitNum
    );
    
    if (!trendingLists || trendingLists.length === 0) {
      return res.json({ lists: [] });
    }
    
    // Enrich with venue data
    const enrichedLists = await Promise.all(
      trendingLists.map(async (list) => {
        try {
          const listDetails = await pool.query(
            'SELECT id, name, description, venue_ids, is_public, created_at FROM user_lists WHERE id = $1',
            [list.id]
          );
          
          if (listDetails.rows.length === 0) return null;
          
          const venueIds = listDetails.rows[0].venue_ids || [];
          let venues = [];
          
          if (venueIds.length > 0) {
            const venuesResult = await pool.query(
              `SELECT id, name, category, cuisine, price_range, rating, image_url
               FROM venues 
               WHERE id = ANY($1::text[])
               LIMIT 5`,
              [venueIds]
            );
            venues = venuesResult.rows;
          }
          
          return {
            ...list,
            ...listDetails.rows[0],
            venues,
          };
        } catch (err) {
          console.error(`Error enriching list ${list.id}:`, err);
          return null; // Skip this list if enrichment fails
        }
      })
    );
    
    return res.json({
      lists: enrichedLists.filter(Boolean),
    });
  } catch (error) {
    console.error('Get trending lists error:', error);
    return res.status(500).json({ error: 'Failed to fetch trending lists' });
  }
});

// Public list sharing endpoint (no auth required) - must be before /:listId
router.get('/share/:shareToken', async (req: Request, res: Response) => {
  const { shareToken } = req.params;
  
  // Validate shareToken format (should be hex string, 64 chars)
  if (!shareToken || shareToken.length !== 64 || !/^[a-f0-9]+$/.test(shareToken)) {
    return res.status(400).json({ error: 'Invalid share token format' });
  }
  
  try {
    const list = await pool.query(
      `SELECT ul.id, ul.name, ul.description, ul.venue_ids, ul.is_public, ul.created_at, ul.view_count,
              u.first_name, u.last_name
       FROM user_lists ul
       JOIN users u ON ul.user_id = u.id
       WHERE ul.share_token = $1 AND ul.is_public = true`,
      [shareToken]
    );
    
    if (list.rows.length === 0) {
      return res.status(404).json({ error: 'List not found or not publicly shared' });
    }
    
    const listData = list.rows[0];
    
    // Increment view count (non-blocking)
    pool.query(
      'UPDATE user_lists SET view_count = view_count + 1 WHERE id = $1',
      [listData.id]
    ).catch(err => console.error('Error incrementing view count:', err));
    
    // Track view (non-blocking)
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    pool.query(
      'INSERT INTO list_views (list_id, ip_address, user_agent) VALUES ($1, $2, $3)',
      [listData.id, ipAddress, userAgent]
    ).catch(err => console.error('Error tracking list view:', err));
    
    // Fetch venues
    const venueIds = listData.venue_ids || [];
    let venues = [];
    
    if (venueIds.length > 0) {
      try {
        const venuesResult = await pool.query(
          `SELECT id, name, category, cuisine, price_range, rating, image_url, address
           FROM venues 
           WHERE id = ANY($1::text[])
           ORDER BY array_position($1::text[], id)`,
          [venueIds]
        );
        venues = venuesResult.rows;
      } catch (err) {
        console.error('Error fetching venues for shared list:', err);
        // Continue without venues rather than failing
      }
    }
    
    return res.json({
      list: {
        id: listData.id,
        name: listData.name,
        description: listData.description,
        venue_ids: listData.venue_ids,
        is_public: listData.is_public,
        created_at: listData.created_at,
        view_count: listData.view_count,
        venues,
        creator: {
          firstName: listData.first_name,
          lastName: listData.last_name,
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