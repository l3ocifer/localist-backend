import { Router, Request, Response } from 'express';
import pool from '../config/database';

const router = Router();

router.get('/:venueId', async (req: Request, res: Response) => {
  const { venueId } = req.params;
  
  try {
    const venue = await pool.query(
      `SELECT v.*, c.name as city_name, c.state, c.country 
       FROM venues v
       LEFT JOIN cities c ON v.city_id = c.id
       WHERE v.id = $1`,
      [venueId]
    );
    
    if (venue.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    return res.json({
      venue: venue.rows[0]
    });
  } catch (error) {
    console.error('Get venue error:', error);
    return res.status(500).json({ error: 'Failed to fetch venue' });
  }
});

router.get('/:venueId/similar', async (req: Request, res: Response) => {
  const { venueId } = req.params;
  const { limit = 5 } = req.query;
  
  try {
    const targetVenue = await pool.query(
      'SELECT city_id, category, cuisine, price_range FROM venues WHERE id = $1',
      [venueId]
    );
    
    if (targetVenue.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    const { city_id, category, cuisine, price_range } = targetVenue.rows[0];
    
    const similarVenues = await pool.query(
      `SELECT id, name, category, cuisine, price_range, rating, image_url
       FROM venues 
       WHERE city_id = $1 
       AND id != $2
       AND (category = $3 OR cuisine = $4 OR price_range = $5)
       ORDER BY 
         CASE 
           WHEN category = $3 AND cuisine = $4 THEN 1
           WHEN category = $3 THEN 2
           WHEN cuisine = $4 THEN 3
           ELSE 4
         END,
         rating DESC NULLS LAST
       LIMIT $6`,
      [city_id, venueId, category, cuisine, price_range, limit]
    );
    
    return res.json({
      similar: similarVenues.rows
    });
  } catch (error) {
    console.error('Get similar venues error:', error);
    return res.status(500).json({ error: 'Failed to fetch similar venues' });
  }
});

export default router;