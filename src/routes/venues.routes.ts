import { Router, Request, Response } from 'express';
import pool from '../config/database';
import logger from '../services/logger.service';

const router = Router();

// =============================================================================
// IMAGE PROXY - Hides API key from client
// =============================================================================

/**
 * GET /api/venues/image/:venueId
 * Proxy for venue images - adds API key server-side
 */
router.get('/image/:venueId', async (req: Request, res: Response) => {
  const { venueId } = req.params;
  const { w = '400' } = req.query; // width, default 400px
  
  try {
    const result = await pool.query(
      'SELECT image_url, google_place_id FROM venues WHERE id = $1',
      [venueId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }
    
    const { image_url } = result.rows[0];
    
    if (!image_url) {
      return res.status(404).json({ error: 'No image available' });
    }
    
    // If image_url already has the full Google URL, proxy it
    if (image_url.includes('places.googleapis.com')) {
      // Ensure API key is present
      let fullUrl = image_url;
      if (!fullUrl.includes('key=')) {
        fullUrl += `&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      }
      // Update width if different
      fullUrl = fullUrl.replace(/maxWidthPx=\d+/, `maxWidthPx=${w}`);
      
      const imageResponse = await fetch(fullUrl);
      if (!imageResponse.ok) {
        return res.status(imageResponse.status).json({ error: 'Image fetch failed' });
      }
      
      // Set caching headers (images don't change often)
      res.set('Cache-Control', 'public, max-age=86400'); // 24 hours
      res.set('Content-Type', imageResponse.headers.get('content-type') || 'image/jpeg');
      
      const buffer = await imageResponse.arrayBuffer();
      return res.send(Buffer.from(buffer));
    }
    
    // Otherwise redirect to the stored URL
    return res.redirect(image_url);
  } catch (error) {
    logger.error('Image proxy error:', error);
    return res.status(500).json({ error: 'Failed to fetch image' });
  }
});

/**
 * GET /api/venues/image-url/:venueId
 * Returns a proxied image URL (for frontend to use)
 */
router.get('/image-url/:venueId', async (req: Request, res: Response) => {
  const { venueId } = req.params;
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
  
  return res.json({
    url: `${baseUrl}/venues/image/${venueId}`,
    venueId,
  });
});

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