import { Router, Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import logger from '../services/logger.service';

const router = Router();

// Middleware to get user ID from authenticated request
const getUserId = (req: Request): string | null => {
  const user = (req as any).user;
  return user?.sub || user?.id || null;
};

// ============ Profile Routes ============

// GET /api/merchant/profile - Get merchant profile
router.get('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      'SELECT * FROM merchant_profiles WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// POST /api/merchant/profile - Create merchant profile
router.post('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { business_name, business_email, phone, website, description } = req.body;

    const result = await pool.query(
      `INSERT INTO merchant_profiles (user_id, business_name, business_email, phone, website, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [userId, business_name, business_email, phone, website, description]
    );

    logger.info(`Merchant profile created for user ${userId}`);
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/merchant/profile - Update merchant profile
router.put('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { business_name, business_email, phone, website, description } = req.body;

    const result = await pool.query(
      `UPDATE merchant_profiles 
       SET business_name = COALESCE($2, business_name),
           business_email = COALESCE($3, business_email),
           phone = COALESCE($4, phone),
           website = COALESCE($5, website),
           description = COALESCE($6, description),
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, business_name, business_email, phone, website, description]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// ============ Stats Routes ============

// GET /api/merchant/stats - Get merchant stats
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get merchant's venues
    const venuesResult = await pool.query(
      'SELECT venue_id FROM merchant_venues WHERE merchant_id = (SELECT id FROM merchant_profiles WHERE user_id = $1) AND claim_status = $2',
      [userId, 'approved']
    );
    const venueIds = venuesResult.rows.map(r => r.venue_id);

    if (venueIds.length === 0) {
      return res.json({
        success: true,
        data: {
          totalViews: 0,
          totalSaves: 0,
          totalClicks: 0,
          activeHappyHours: 0,
          activePopUps: 0,
          pendingSubmissions: 0
        }
      });
    }

    // Count interactions
    const viewsResult = await pool.query(
      `SELECT COUNT(*) as count FROM user_interactions 
       WHERE venue_id = ANY($1) AND interaction_type = 'view'`,
      [venueIds]
    );
    const savesResult = await pool.query(
      `SELECT COUNT(*) as count FROM user_interactions 
       WHERE venue_id = ANY($1) AND interaction_type = 'save'`,
      [venueIds]
    );

    // Count active happy hours and events
    const happyHoursResult = await pool.query(
      `SELECT COUNT(*) as count FROM happy_hours 
       WHERE venue_id = ANY($1) AND status = 'active'`,
      [venueIds]
    );
    const popUpsResult = await pool.query(
      `SELECT COUNT(*) as count FROM pop_up_events 
       WHERE venue_id = ANY($1) AND status = 'active' AND event_date >= CURRENT_DATE`,
      [venueIds]
    );
    const pendingResult = await pool.query(
      `SELECT 
        (SELECT COUNT(*) FROM happy_hours WHERE venue_id = ANY($1) AND status = 'pending') +
        (SELECT COUNT(*) FROM pop_up_events WHERE venue_id = ANY($1) AND status = 'pending') as count`,
      [venueIds]
    );

    return res.json({
      success: true,
      data: {
        totalViews: parseInt(viewsResult.rows[0]?.count || '0'),
        totalSaves: parseInt(savesResult.rows[0]?.count || '0'),
        totalClicks: 0, // Would need click tracking
        activeHappyHours: parseInt(happyHoursResult.rows[0]?.count || '0'),
        activePopUps: parseInt(popUpsResult.rows[0]?.count || '0'),
        pendingSubmissions: parseInt(pendingResult.rows[0]?.count || '0')
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============ Venues Routes ============

// GET /api/merchant/venues - Get merchant's claimed venues
router.get('/venues', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT mv.*, v.name as venue_name, v.address as venue_address
       FROM merchant_venues mv
       JOIN venues v ON mv.venue_id = v.id
       WHERE mv.merchant_id = (SELECT id FROM merchant_profiles WHERE user_id = $1)
       ORDER BY mv.created_at DESC`,
      [userId]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/merchant/venues/:venueId/claim - Claim a venue
router.post('/venues/:venueId/claim', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { venueId } = req.params;

    // Get merchant profile
    const profileResult = await pool.query(
      'SELECT id FROM merchant_profiles WHERE user_id = $1',
      [userId]
    );

    if (profileResult.rows.length === 0) {
      return res.status(400).json({ error: 'Create a merchant profile first' });
    }

    const merchantId = profileResult.rows[0].id;

    // Check if already claimed
    const existingClaim = await pool.query(
      'SELECT id FROM merchant_venues WHERE venue_id = $1 AND claim_status = $2',
      [venueId, 'approved']
    );

    if (existingClaim.rows.length > 0) {
      return res.status(400).json({ error: 'Venue already claimed by another merchant' });
    }

    const result = await pool.query(
      `INSERT INTO merchant_venues (merchant_id, venue_id, claim_status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (merchant_id, venue_id) DO UPDATE SET claim_status = 'pending'
       RETURNING *`,
      [merchantId, venueId]
    );

    logger.info(`Venue ${venueId} claim requested by merchant ${merchantId}`);
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// ============ Happy Hours Routes ============

// GET /api/merchant/happy-hours - Get merchant's happy hours
router.get('/happy-hours', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { status } = req.query;

    let query = `
      SELECT hh.* FROM happy_hours hh
      JOIN merchant_venues mv ON hh.venue_id = mv.venue_id
      JOIN merchant_profiles mp ON mv.merchant_id = mp.id
      WHERE mp.user_id = $1
    `;
    const params: any[] = [userId];

    if (status) {
      query += ` AND hh.status = $2`;
      params.push(status);
    }

    query += ' ORDER BY hh.created_at DESC';

    const result = await pool.query(query, params);
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/merchant/happy-hours - Create happy hour
router.post('/happy-hours', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { venue_id, title, description, day_of_week, start_time, end_time, deals, menu_url, starts_at, ends_at } = req.body;

    // Verify merchant owns this venue
    const ownership = await pool.query(
      `SELECT 1 FROM merchant_venues mv
       JOIN merchant_profiles mp ON mv.merchant_id = mp.id
       WHERE mp.user_id = $1 AND mv.venue_id = $2 AND mv.claim_status = 'approved'`,
      [userId, venue_id]
    );

    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this venue' });
    }

    const result = await pool.query(
      `INSERT INTO happy_hours (venue_id, title, description, day_of_week, start_time, end_time, deals, menu_url, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING *`,
      [venue_id, title, description, day_of_week, start_time, end_time, deals, menu_url, starts_at, ends_at]
    );

    logger.info(`Happy hour created for venue ${venue_id}`);
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/merchant/happy-hours/:id - Update happy hour
router.put('/happy-hours/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const { title, description, day_of_week, start_time, end_time, deals, menu_url } = req.body;

    // Verify ownership
    const ownership = await pool.query(
      `SELECT hh.id FROM happy_hours hh
       JOIN merchant_venues mv ON hh.venue_id = mv.venue_id
       JOIN merchant_profiles mp ON mv.merchant_id = mp.id
       WHERE mp.user_id = $1 AND hh.id = $2`,
      [userId, id]
    );

    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await pool.query(
      `UPDATE happy_hours SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        day_of_week = COALESCE($4, day_of_week),
        start_time = COALESCE($5, start_time),
        end_time = COALESCE($6, end_time),
        deals = COALESCE($7, deals),
        menu_url = COALESCE($8, menu_url),
        updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, title, description, day_of_week, start_time, end_time, deals, menu_url]
    );

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/merchant/happy-hours/:id - Delete happy hour
router.delete('/happy-hours/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;

    // Verify ownership
    const ownership = await pool.query(
      `SELECT hh.id FROM happy_hours hh
       JOIN merchant_venues mv ON hh.venue_id = mv.venue_id
       JOIN merchant_profiles mp ON mv.merchant_id = mp.id
       WHERE mp.user_id = $1 AND hh.id = $2`,
      [userId, id]
    );

    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query('DELETE FROM happy_hours WHERE id = $1', [id]);
    return res.json({ success: true, message: 'Deleted' });
  } catch (error) {
    next(error);
  }
});

// ============ Pop-Up Events Routes ============

// GET /api/merchant/pop-ups - Get merchant's pop-up events
router.get('/pop-ups', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { status } = req.query;

    let query = `
      SELECT pe.* FROM pop_up_events pe
      JOIN merchant_venues mv ON pe.venue_id = mv.venue_id
      JOIN merchant_profiles mp ON mv.merchant_id = mp.id
      WHERE mp.user_id = $1
    `;
    const params: any[] = [userId];

    if (status) {
      if (status === 'expired') {
        query += ` AND pe.event_date < CURRENT_DATE`;
      } else {
        query += ` AND pe.status = $2`;
        params.push(status);
      }
    }

    query += ' ORDER BY pe.event_date DESC';

    const result = await pool.query(query, params);
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/merchant/pop-ups - Create pop-up event
router.post('/pop-ups', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { venue_id, title, description, event_date, start_time, end_time, ticket_url, price } = req.body;

    // Verify merchant owns this venue
    const ownership = await pool.query(
      `SELECT 1 FROM merchant_venues mv
       JOIN merchant_profiles mp ON mv.merchant_id = mp.id
       WHERE mp.user_id = $1 AND mv.venue_id = $2 AND mv.claim_status = 'approved'`,
      [userId, venue_id]
    );

    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this venue' });
    }

    const result = await pool.query(
      `INSERT INTO pop_up_events (venue_id, title, description, event_date, start_time, end_time, ticket_url, price, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING *`,
      [venue_id, title, description, event_date, start_time, end_time, ticket_url, price]
    );

    logger.info(`Pop-up event created for venue ${venue_id}`);
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/merchant/pop-ups/:id - Update pop-up event
router.put('/pop-ups/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const { title, description, event_date, start_time, end_time, ticket_url, price } = req.body;

    // Verify ownership
    const ownership = await pool.query(
      `SELECT pe.id FROM pop_up_events pe
       JOIN merchant_venues mv ON pe.venue_id = mv.venue_id
       JOIN merchant_profiles mp ON mv.merchant_id = mp.id
       WHERE mp.user_id = $1 AND pe.id = $2`,
      [userId, id]
    );

    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await pool.query(
      `UPDATE pop_up_events SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        event_date = COALESCE($4, event_date),
        start_time = COALESCE($5, start_time),
        end_time = COALESCE($6, end_time),
        ticket_url = COALESCE($7, ticket_url),
        price = COALESCE($8, price),
        updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, title, description, event_date, start_time, end_time, ticket_url, price]
    );

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/merchant/pop-ups/:id - Delete pop-up event
router.delete('/pop-ups/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;

    // Verify ownership
    const ownership = await pool.query(
      `SELECT pe.id FROM pop_up_events pe
       JOIN merchant_venues mv ON pe.venue_id = mv.venue_id
       JOIN merchant_profiles mp ON mv.merchant_id = mp.id
       WHERE mp.user_id = $1 AND pe.id = $2`,
      [userId, id]
    );

    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query('DELETE FROM pop_up_events WHERE id = $1', [id]);
    return res.json({ success: true, message: 'Deleted' });
  } catch (error) {
    next(error);
  }
});

// ============ Analytics Routes ============

// GET /api/merchant/analytics - Get analytics data
router.get('/analytics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const period = (req.query.period as string) || '30d';
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

    // Get merchant's venues
    const venuesResult = await pool.query(
      `SELECT mv.venue_id FROM merchant_venues mv
       JOIN merchant_profiles mp ON mv.merchant_id = mp.id
       WHERE mp.user_id = $1 AND mv.claim_status = 'approved'`,
      [userId]
    );
    const venueIds = venuesResult.rows.map(r => r.venue_id);

    if (venueIds.length === 0) {
      return res.json({
        success: true,
        data: { views: [], saves: [], clicks: [] }
      });
    }

    // Generate date series and count interactions
    const query = `
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '${days - 1} days',
          CURRENT_DATE,
          '1 day'::interval
        )::date as date
      )
      SELECT 
        ds.date::text,
        COALESCE(SUM(CASE WHEN ui.interaction_type = 'view' THEN 1 ELSE 0 END), 0)::int as views,
        COALESCE(SUM(CASE WHEN ui.interaction_type = 'save' THEN 1 ELSE 0 END), 0)::int as saves,
        0::int as clicks
      FROM date_series ds
      LEFT JOIN user_interactions ui ON DATE(ui.created_at) = ds.date AND ui.venue_id = ANY($1)
      GROUP BY ds.date
      ORDER BY ds.date
    `;

    const result = await pool.query(query, [venueIds]);

    const views = result.rows.map(r => ({ date: r.date, count: r.views }));
    const saves = result.rows.map(r => ({ date: r.date, count: r.saves }));
    const clicks = result.rows.map(r => ({ date: r.date, count: r.clicks }));

    return res.json({
      success: true,
      data: { views, saves, clicks }
    });
  } catch (error) {
    next(error);
  }
});

export default router;

