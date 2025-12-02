import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { CsvImportService } from '../services/csv-import.service';
import { ReviewQueueService } from '../services/review-queue.service';
import { ScrapingJobService } from '../services/scraping-job.service';
import logger from '../services/logger.service';

const router = Router();
const upload = multer({ dest: 'uploads/' });
const csvImportService = CsvImportService.getInstance();
const reviewQueueService = ReviewQueueService.getInstance();
const jobService = ScrapingJobService.getInstance();

// --- CSV Import ---

router.post('/import/csv', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // For MVP, assume user is admin/authorized. In prod, check req.user
    const userId = (req as any).user?.id; 

    const batchId = await csvImportService.createBatch(req.file.originalname, userId);
    
    // Process asynchronously
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
    const userId = (req as any).user?.id || 'admin'; // Fallback for now

    await reviewQueueService.approveItem(id, userId);

    res.json({
      success: true,
      message: 'Item approved successfully'
    });
  } catch (error) {
    next(error);
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
    next(error);
  }
});

// --- Scraping Control ---
// Note: Main scraping is now via /api/scraper/google/scrape/:cityId
// This endpoint is for tracking jobs only

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
