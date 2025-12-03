import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import pool from '../config/database';
import { CsvImportService } from '../services/csv-import.service';
import { ReviewQueueService } from '../services/review-queue.service';
import { ScrapingJobService } from '../services/scraping-job.service';
import logger from '../services/logger.service';

const router = Router();
const upload = multer({ dest: 'uploads/' });
const csvImportService = CsvImportService.getInstance();
const reviewQueueService = ReviewQueueService.getInstance();
const jobService = ScrapingJobService.getInstance();

// Middleware to get admin user ID
const getAdminId = (req: Request): string | null => {
  const user = (req as any).user;
  return user?.sub || user?.id || null;
};

// ============ Dashboard Stats ============

router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [
      usersResult,
      venuesResult,
      listsResult,
      citiesResult,
      pendingReviewsResult,
      pendingMerchantsResult
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM users'),
      pool.query('SELECT COUNT(*) as count FROM venues'),
      pool.query('SELECT COUNT(*) as count FROM lists'),
      pool.query('SELECT COUNT(*) as count FROM cities'),
      pool.query("SELECT COUNT(*) as count FROM review_queue WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) as count FROM merchant_submissions WHERE status = 'pending'")
    ]);

    // Recent activity (last 7 days)
    const recentUsersResult = await pool.query(
      "SELECT COUNT(*) as count FROM users WHERE created_at > NOW() - INTERVAL '7 days'"
    );
    const recentVenuesResult = await pool.query(
      "SELECT COUNT(*) as count FROM venues WHERE created_at > NOW() - INTERVAL '7 days'"
    );

    return res.json({
      success: true,
      data: {
        totalUsers: parseInt(usersResult.rows[0]?.count || '0'),
        totalVenues: parseInt(venuesResult.rows[0]?.count || '0'),
        totalLists: parseInt(listsResult.rows[0]?.count || '0'),
        totalCities: parseInt(citiesResult.rows[0]?.count || '0'),
        pendingReviews: parseInt(pendingReviewsResult.rows[0]?.count || '0'),
        pendingMerchantSubmissions: parseInt(pendingMerchantsResult.rows[0]?.count || '0'),
        recentUsers: parseInt(recentUsersResult.rows[0]?.count || '0'),
        recentVenues: parseInt(recentVenuesResult.rows[0]?.count || '0')
      }
    });
  } catch (error) {
    return next(error);
  }
});

// ============ Users Management ============

router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, role, page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let query = 'SELECT id, email, name, role, is_admin, created_at, last_login FROM users WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (email ILIKE $${paramIndex} OR name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (role === 'admin') {
      query += ` AND is_admin = true`;
    } else if (role === 'merchant') {
      query += ` AND id IN (SELECT user_id FROM merchant_profiles)`;
    }

    const countQuery = query.replace('SELECT id, email, name, role, is_admin, created_at, last_login', 'SELECT COUNT(*) as count');
    const countResult = await pool.query(countQuery, params);

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum, offset);

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows,
      meta: {
        total: parseInt(countResult.rows[0]?.count || '0'),
        page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:userId/admin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const { is_admin } = req.body;

    await pool.query('UPDATE users SET is_admin = $1 WHERE id = $2', [is_admin, userId]);

    logger.info(`User ${userId} admin status changed to ${is_admin}`);
    return res.json({ success: true, message: 'User updated' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:userId/role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);

    return res.json({ success: true, message: 'User role updated' });
  } catch (error) {
    return next(error);
  }
});

// ============ Venues Management ============

router.post('/venues', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, address, city_id, category, cuisine_type, price_range, rating, latitude, longitude, phone, website, description } = req.body;

    const result = await pool.query(
      `INSERT INTO venues (name, address, city_id, category, cuisine_type, price_range, rating, latitude, longitude, phone, website, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [name, address, city_id, category, cuisine_type, price_range, rating, latitude, longitude, phone, website, description]
    );

    logger.info(`Venue created: ${name}`);
    return res.status(201).json({ success: true, venue: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/venues/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, address, city_id, category, cuisine_type, price_range, rating, latitude, longitude, phone, website, description, is_ddd_featured } = req.body;

    const result = await pool.query(
      `UPDATE venues SET
        name = COALESCE($2, name),
        address = COALESCE($3, address),
        city_id = COALESCE($4, city_id),
        category = COALESCE($5, category),
        cuisine_type = COALESCE($6, cuisine_type),
        price_range = COALESCE($7, price_range),
        rating = COALESCE($8, rating),
        latitude = COALESCE($9, latitude),
        longitude = COALESCE($10, longitude),
        phone = COALESCE($11, phone),
        website = COALESCE($12, website),
        description = COALESCE($13, description),
        is_ddd_featured = COALESCE($14, is_ddd_featured),
        updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, name, address, city_id, category, cuisine_type, price_range, rating, latitude, longitude, phone, website, description, is_ddd_featured]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    return res.json({ success: true, venue: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/venues/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM venues WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    logger.info(`Venue deleted: ${id}`);
    return res.json({ success: true, message: 'Venue deleted' });
  } catch (error) {
    return next(error);
  }
});

// ============ Lists Management ============

router.put('/lists/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, description, category, is_featured } = req.body;

    const result = await pool.query(
      `UPDATE lists SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        category = COALESCE($4, category),
        is_featured = COALESCE($5, is_featured),
        updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, name, description, category, is_featured]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }

    return res.json({ success: true, list: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/lists/:id/featured', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { is_featured } = req.body;

    await pool.query('UPDATE lists SET is_featured = $1, updated_at = NOW() WHERE id = $2', [is_featured, id]);

    return res.json({ success: true, message: 'List featured status updated' });
  } catch (error) {
    return next(error);
  }
});

router.delete('/lists/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM lists WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }

    logger.info(`List deleted: ${id}`);
    return res.json({ success: true, message: 'List deleted' });
  } catch (error) {
    return next(error);
  }
});

// ============ Merchant Submissions ============

router.get('/merchant-submissions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, type, page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT ms.*, mp.business_email as merchant_email, v.name as venue_name, v.address as venue_address
      FROM merchant_submissions ms
      LEFT JOIN merchant_profiles mp ON ms.merchant_id = mp.id
      LEFT JOIN venues v ON ms.venue_id = v.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND ms.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (type) {
      query += ` AND ms.submission_type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT ms\.\*.*FROM/, 'SELECT COUNT(*) as count FROM');
    const countResult = await pool.query(countQuery, params);

    query += ` ORDER BY ms.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum, offset);

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows,
      meta: {
        total: parseInt(countResult.rows[0]?.count || '0'),
        page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/merchant-submissions/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adminId = getAdminId(req);

    // Get submission details
    const submission = await pool.query('SELECT * FROM merchant_submissions WHERE id = $1', [id]);
    if (submission.rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const sub = submission.rows[0];

    // Update submission status
    await pool.query(
      `UPDATE merchant_submissions 
       SET status = 'approved', reviewed_by = $2, reviewed_at = NOW() 
       WHERE id = $1`,
      [id, adminId]
    );

    // If there's a reference_id, also update the underlying happy_hour or pop_up_event
    if (sub.reference_id) {
      const table = sub.submission_type === 'happy_hour' ? 'happy_hours' : 'pop_up_events';
      await pool.query(`UPDATE ${table} SET status = 'active' WHERE id = $1`, [sub.reference_id]);
    }

    logger.info(`Merchant submission ${id} approved by ${adminId}`);
    return res.json({ success: true, message: 'Submission approved' });
  } catch (error) {
    return next(error);
  }
});

router.post('/merchant-submissions/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = getAdminId(req);

    // Get submission details
    const submission = await pool.query('SELECT * FROM merchant_submissions WHERE id = $1', [id]);
    if (submission.rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const sub = submission.rows[0];

    // Update submission status
    await pool.query(
      `UPDATE merchant_submissions 
       SET status = 'rejected', rejection_reason = $2, reviewed_by = $3, reviewed_at = NOW() 
       WHERE id = $1`,
      [id, reason, adminId]
    );

    // If there's a reference_id, also update the underlying happy_hour or pop_up_event
    if (sub.reference_id) {
      const table = sub.submission_type === 'happy_hour' ? 'happy_hours' : 'pop_up_events';
      await pool.query(`UPDATE ${table} SET status = 'rejected' WHERE id = $1`, [sub.reference_id]);
    }

    logger.info(`Merchant submission ${id} rejected by ${adminId}`);
    return res.json({ success: true, message: 'Submission rejected' });
  } catch (error) {
    return next(error);
  }
});

// ============ Merchant Profiles Management ============

router.get('/merchant-profiles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT mp.*, u.email as user_email, u.name as user_name,
        (SELECT COUNT(*) FROM merchant_venues mv WHERE mv.merchant_id = mp.id AND mv.claim_status = 'approved') as venue_count
      FROM merchant_profiles mp
      LEFT JOIN users u ON mp.user_id = u.id::text OR mp.user_id = u.logto_sub
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND mp.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    const countQuery = query.replace(/SELECT mp\.\*.*FROM/, 'SELECT COUNT(*) as count FROM');
    const countResult = await pool.query(countQuery, params);

    query += ` ORDER BY mp.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum, offset);

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows,
      meta: {
        total: parseInt(countResult.rows[0]?.count || '0'),
        page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/merchant-profiles/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    await pool.query("UPDATE merchant_profiles SET status = 'approved', updated_at = NOW() WHERE id = $1", [id]);

    logger.info(`Merchant profile ${id} approved`);
    return res.json({ success: true, message: 'Merchant approved' });
  } catch (error) {
    return next(error);
  }
});

router.post('/merchant-profiles/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    await pool.query("UPDATE merchant_profiles SET status = 'rejected', updated_at = NOW() WHERE id = $1", [id]);

    logger.info(`Merchant profile ${id} rejected`);
    return res.json({ success: true, message: 'Merchant rejected' });
  } catch (error) {
    return next(error);
  }
});

// ============ Venue Claims Management ============

router.get('/venue-claims', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status = 'pending' } = req.query;

    const result = await pool.query(
      `SELECT mv.*, v.name as venue_name, v.address as venue_address, mp.business_name, mp.business_email
       FROM merchant_venues mv
       JOIN venues v ON mv.venue_id = v.id
       JOIN merchant_profiles mp ON mv.merchant_id = mp.id
       WHERE mv.claim_status = $1
       ORDER BY mv.created_at DESC`,
      [status]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/venue-claims/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    await pool.query("UPDATE merchant_venues SET claim_status = 'approved', is_claimed = true WHERE id = $1", [id]);

    logger.info(`Venue claim ${id} approved`);
    return res.json({ success: true, message: 'Claim approved' });
  } catch (error) {
    return next(error);
  }
});

router.post('/venue-claims/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    await pool.query("UPDATE merchant_venues SET claim_status = 'rejected' WHERE id = $1", [id]);

    logger.info(`Venue claim ${id} rejected`);
    return res.json({ success: true, message: 'Claim rejected' });
  } catch (error) {
    return next(error);
  }
});

// --- CSV Import ---

router.post('/import/csv', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = (req as any).user?.id;
    const batchId = await csvImportService.createBatch(req.file.originalname, userId);
    
    csvImportService.processFile(batchId, req.file.path).catch(err => {
      logger.error('Async CSV processing failed', err);
    });

    return res.status(202).json({
      success: true,
      message: 'CSV import started',
      batchId
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/import/status/:batchId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;
    const status = await csvImportService.getBatchStatus(batchId);
    if (!status) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    return res.json({ success: true, data: status });
  } catch (error) {
    return next(error);
  }
});

// --- Review Queue ---

router.get('/review-queue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const result = await reviewQueueService.getPendingItems(limit, offset);

    return res.json({
      success: true,
      data: result.items,
      meta: {
        total: result.total,
        page,
        limit
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/review-queue/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id || 'admin';

    await reviewQueueService.approveItem(id, userId);

    res.json({
      success: true,
      message: 'Item approved successfully'
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/review-queue/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = (req as any).user?.id || 'admin';

    await reviewQueueService.rejectItem(id, userId, reason);

    res.json({
      success: true,
      message: 'Item rejected successfully'
    });
  } catch (error) {
    return next(error);
  }
});

// --- Scraping Control ---

router.get('/scrape/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId, status, limit } = req.query;
    
    if (jobId) {
      const job = await jobService.getJob(jobId as string);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      return res.json({ success: true, data: job });
    }

    const jobs = await jobService.getJobs({
      status: status as string,
      limit: limit ? parseInt(limit as string) : 20
    });

    return res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
