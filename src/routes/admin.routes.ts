import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ScraperService } from '../services/scraper.service';
import { CSVImportService } from '../services/csv-import.service';
import { ImageService } from '../services/image.service';
import { ReviewQueueService } from '../services/review-queue.service';
import { authenticateAdmin } from '../middleware/auth.middleware';
import pool from '../config/database';
import logger from '../services/logger.service';

const router = Router();

// All admin routes require admin authentication
router.use(authenticateAdmin);
const scraperService = ScraperService.getInstance();
const csvImportService = new CSVImportService();
const imageService = ImageService.getInstance();
const reviewQueueService = new ReviewQueueService();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// ============================================================================
// SCRAPING MANAGEMENT
// ============================================================================

/**
 * Start a scraping job
 * POST /api/admin/scrape/start
 */
router.post('/scrape/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobType, sourceId, cityId, category, maxVenues } = req.body;

    if (!jobType || !['api_scrape', 'web_scrape', 'csv_import', 'manual_curation'].includes(jobType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid jobType. Must be: api_scrape, web_scrape, csv_import, or manual_curation'
      });
    }

    const jobId = await scraperService.startScrapingJob(
      jobType,
      sourceId || null,
      { cityId, category, maxVenues }
    );

    return res.json({
      success: true,
      jobId,
      message: 'Scraping job started'
    });
  } catch (error) {
    logger.error('Error starting scraping job', error);
    return next(error);
  }
});

/**
 * Get scraping job status
 * GET /api/admin/scrape/status/:jobId
 */
router.get('/scrape/status/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const status = await scraperService.getJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    return res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Error getting scraping job status', error);
    return next(error);
  }
});

/**
 * List scraping jobs
 * GET /api/admin/scrape/jobs
 */
router.get('/scrape/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, jobType, sourceId, cityId, limit, offset } = req.query;

    const result = await scraperService.listJobs({
      status: status as string,
      jobType: jobType as string,
      sourceId: sourceId as string,
      cityId: cityId as string,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0
    });

    return res.json({
      success: true,
      data: result.jobs,
      pagination: {
        total: result.total,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0
      }
    });
  } catch (error) {
    logger.error('Error listing scraping jobs', error);
    return next(error);
  }
});

/**
 * Cancel scraping job
 * POST /api/admin/scrape/cancel/:jobId
 */
router.post('/scrape/cancel/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const cancelled = await scraperService.cancelJob(jobId);

    if (!cancelled) {
      return res.status(400).json({
        success: false,
        error: 'Job cannot be cancelled (not found or not in cancellable state)'
      });
    }

    return res.json({
      success: true,
      message: 'Job cancelled'
    });
  } catch (error) {
    logger.error('Error cancelling scraping job', error);
    return next(error);
  }
});

// ============================================================================
// CSV IMPORT
// ============================================================================

/**
 * Upload CSV file for import
 * POST /api/admin/import/csv
 */
router.post('/import/csv', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const { mapping, cityId, skipFirstRow } = req.body;
    const config = {
      mapping: mapping ? JSON.parse(mapping) : undefined,
      cityId,
      skipFirstRow: skipFirstRow === 'true'
    };

    const batchId = await csvImportService.createImportBatch(
      req.file.originalname,
      req.file.buffer,
      config
    );

    return res.json({
      success: true,
      batchId,
      message: 'CSV import started'
    });
  } catch (error) {
    logger.error('Error starting CSV import', error);
    return next(error);
  }
});

/**
 * Get CSV import batch status
 * GET /api/admin/import/status/:batchId
 */
router.get('/import/status/:batchId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;
    const status = await csvImportService.getBatchStatus(batchId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Import batch not found'
      });
    }

    return res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Error getting CSV import status', error);
    return next(error);
  }
});

/**
 * List CSV import batches
 * GET /api/admin/import/batches
 */
router.get('/import/batches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, limit, offset } = req.query;

    const result = await csvImportService.listBatches({
      status: status as string,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0
    });

    return res.json({
      success: true,
      data: result.batches,
      pagination: {
        total: result.total,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0
      }
    });
  } catch (error) {
    logger.error('Error listing CSV import batches', error);
    return next(error);
  }
});

// ============================================================================
// IMAGE UPLOAD
// ============================================================================

/**
 * Upload image
 * POST /api/admin/images/upload
 */
router.post('/images/upload', upload.single('image'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file uploaded'
      });
    }

    const { venueId } = req.body;
    const contentType = req.file.mimetype;

    const result = await imageService.uploadImage(
      req.file.buffer,
      contentType,
      venueId
    );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error uploading image', error);
    return next(error);
  }
});

/**
 * Upload image from URL
 * POST /api/admin/images/upload-from-url
 */
router.post('/images/upload-from-url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url, venueId } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    const result = await imageService.uploadFromUrl(url, venueId);

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error uploading image from URL', error);
    return next(error);
  }
});

// ============================================================================
// CONTENT REVIEW QUEUE
// ============================================================================

/**
 * Get review queue
 * GET /api/admin/review-queue
 */
router.get('/review-queue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, contentType, priority, requiresManualReview, limit, offset } = req.query;

    const result = await reviewQueueService.getQueue({
      status: status as string,
      contentType: contentType as 'venue' | 'list' | 'review' | 'image',
      priority: priority ? parseInt(priority as string) : undefined,
      requiresManualReview: requiresManualReview === 'true' ? true : undefined,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0
    });

    return res.json({
      success: true,
      data: result.items,
      pagination: {
        total: result.total,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0
      }
    });
  } catch (error) {
    logger.error('Error getting review queue', error);
    return next(error);
  }
});

/**
 * Approve review queue item
 * POST /api/admin/review-queue/:id/approve
 */
router.post('/review-queue/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reviewedBy, notes } = req.body;

    if (!reviewedBy) {
      return res.status(400).json({
        success: false,
        error: 'reviewedBy is required'
      });
    }

    const approved = await reviewQueueService.approveItem(id, reviewedBy, notes);

    if (!approved) {
      return res.status(400).json({
        success: false,
        error: 'Item cannot be approved (not found or not in approvable state)'
      });
    }

    return res.json({
      success: true,
      message: 'Item approved'
    });
  } catch (error) {
    logger.error('Error approving review queue item', error);
    return next(error);
  }
});

/**
 * Reject review queue item
 * POST /api/admin/review-queue/:id/reject
 */
router.post('/review-queue/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reviewedBy, notes } = req.body;

    if (!reviewedBy) {
      return res.status(400).json({
        success: false,
        error: 'reviewedBy is required'
      });
    }

    const rejected = await reviewQueueService.rejectItem(id, reviewedBy, notes);

    if (!rejected) {
      return res.status(400).json({
        success: false,
        error: 'Item cannot be rejected (not found or not in rejectable state)'
      });
    }

    return res.json({
      success: true,
      message: 'Item rejected'
    });
  } catch (error) {
    logger.error('Error rejecting review queue item', error);
    return next(error);
  }
});

/**
 * Mark review queue item as needs changes
 * POST /api/admin/review-queue/:id/needs-changes
 */
router.post('/review-queue/:id/needs-changes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reviewedBy, notes } = req.body;

    if (!reviewedBy || !notes) {
      return res.status(400).json({
        success: false,
        error: 'reviewedBy and notes are required'
      });
    }

    const updated = await reviewQueueService.markNeedsChanges(id, reviewedBy, notes);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }

    return res.json({
      success: true,
      message: 'Item marked as needs changes'
    });
  } catch (error) {
    logger.error('Error marking review queue item', error);
    return next(error);
  }
});

/**
 * Mark review queue item as duplicate
 * POST /api/admin/review-queue/:id/duplicate
 */
router.post('/review-queue/:id/duplicate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { duplicateOfId, reviewedBy } = req.body;

    if (!duplicateOfId || !reviewedBy) {
      return res.status(400).json({
        success: false,
        error: 'duplicateOfId and reviewedBy are required'
      });
    }

    const updated = await reviewQueueService.markDuplicate(id, duplicateOfId, reviewedBy);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }

    return res.json({
      success: true,
      message: 'Item marked as duplicate'
    });
  } catch (error) {
    logger.error('Error marking review queue item as duplicate', error);
    return next(error);
  }
});

// ============================================================================
// ADMIN DASHBOARD STATISTICS
// ============================================================================

/**
 * Get admin dashboard statistics
 * GET /api/admin/stats
 */
router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Get scraping job statistics
    const scrapingStats = await pool.query(`
      SELECT 
        COUNT(*) as total_jobs,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
        COUNT(*) FILTER (WHERE status = 'running') as running_jobs,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
        SUM(venues_found) as total_venues_found,
        SUM(venues_added) as total_venues_added,
        SUM(venues_updated) as total_venues_updated,
        SUM(venues_failed) as total_venues_failed
      FROM scraping_jobs
      WHERE created_at > NOW() - INTERVAL '30 days'
    `);

    // Get CSV import statistics
    const importStats = await pool.query(`
      SELECT 
        COUNT(*) as total_batches,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_batches,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_batches,
        SUM(total_rows) as total_rows_processed,
        SUM(rows_successful) as total_rows_successful,
        SUM(rows_failed) as total_rows_failed
      FROM import_batches
      WHERE created_at > NOW() - INTERVAL '30 days'
    `);

    // Get review queue statistics
    const reviewStats = await pool.query(`
      SELECT 
        COUNT(*) as total_items,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_items,
        COUNT(*) FILTER (WHERE status = 'in_review') as in_review_items,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_items,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_items,
        COUNT(*) FILTER (WHERE requires_manual_review = true) as manual_review_items
      FROM content_review_queue
    `);

    // Get recent activity (last 7 days)
    const recentActivity = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        job_type,
        COUNT(*) as count,
        SUM(venues_added) as venues_added
      FROM scraping_jobs
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at), job_type
      ORDER BY date DESC, job_type
    `);

    return res.json({
      success: true,
      data: {
        scraping: scrapingStats.rows[0] || {},
        imports: importStats.rows[0] || {},
        reviewQueue: reviewStats.rows[0] || {},
        recentActivity: recentActivity.rows || []
      }
    });
  } catch (error) {
    logger.error('Error getting admin statistics', error);
    return next(error);
  }
});

export default router;

