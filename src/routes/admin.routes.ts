import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { CsvImportService } from '../services/csv-import.service';
import { ReviewQueueService } from '../services/review-queue.service';
import logger from '../services/logger.service';
import { ScraperOrchestratorService } from '../services/scraper-orchestrator.service';

const router = Router();
const upload = multer({ dest: 'uploads/' });
// We assume these services exist or will be created. If not, this will error at runtime/compile time.
// Based on file list, csv-import.service.ts and review-queue.service.ts exist.
const csvImportService = CsvImportService.getInstance();
const reviewQueueService = ReviewQueueService.getInstance();
const scraperOrchestrator = ScraperOrchestratorService.getInstance();

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

router.post('/scrape/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { cityId, category, jobType, sources } = req.body;
        
        // Map legacy 'source' field to 'sources' array or jobType if needed
        let effectiveJobType = jobType;
        let effectiveSources = sources;

        if (!effectiveJobType) {
            if (req.body.source && ['google', 'yelp', 'foursquare'].includes(req.body.source)) {
                effectiveJobType = 'api_scrape'; // Or specific types like 'google_places'
                // For backward compatibility with Orchestrator logic:
                if (req.body.source === 'google') effectiveJobType = 'google_places';
                if (req.body.source === 'yelp') effectiveJobType = 'yelp';
                if (req.body.source === 'foursquare') effectiveJobType = 'foursquare';
            } else if (req.body.source) {
                 effectiveJobType = 'web_scrape';
                 effectiveSources = [req.body.source];
            } else {
                effectiveJobType = 'all_sources';
            }
        }

        const jobId = await scraperOrchestrator.startScrapingJob(effectiveJobType, {
            cityId,
            category,
            sources: effectiveSources
        });

        res.json({
            success: true,
            message: `Scraping job started`,
            jobId
        });
    } catch (error) {
        next(error);
    }
});

router.get('/scrape/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { jobId, status, limit } = req.query;
        
        if (jobId) {
            const job = await scraperOrchestrator.getJobStatus(jobId as string);
            if (!job) return res.status(404).json({ error: 'Job not found' });
            return res.json({ success: true, data: job });
        }

        const jobs = await scraperOrchestrator.getJobs({
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
