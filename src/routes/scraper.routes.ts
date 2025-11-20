import { Router, Request, Response, NextFunction } from 'express';
import { ScraperOrchestratorService } from '../services/scraper-orchestrator.service';
import logger from '../services/logger.service';

const router = Router();
const scraperOrchestrator = ScraperOrchestratorService.getInstance();

// Get scraper status (Active jobs count)
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const activeCount = await scraperOrchestrator.getActiveJobsCount();
    res.json({
      success: true,
      data: {
        activeJobs: activeCount,
        isRunning: activeCount > 0
      }
    });
  } catch (error) {
    logger.error('Error getting scraper status:', error);
    next(error);
  }
});

// Manually trigger scraping for a specific city
router.post('/scrape/:cityId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cityId } = req.params;
    const { category, jobType } = req.body;

    if (!cityId) {
      return res.status(400).json({
        success: false,
        error: 'City ID is required'
      });
    }

    const jobId = await scraperOrchestrator.startScrapingJob(jobType || 'all_sources', {
        cityId,
        category
    });

    return res.json({
      success: true,
      message: `Scraping started for city ${cityId}`,
      jobId
    });
  } catch (error) {
    logger.error('Error starting scraper:', error);
    return next(error);
  }
});

// Trigger scraping for all cities
router.post('/scrape-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobType } = req.body;
    
    const jobId = await scraperOrchestrator.startScrapingJob(jobType || 'all_sources', {});

    res.json({
      success: true,
      message: 'Scraping started for all cities',
      jobId
    });
  } catch (error) {
    logger.error('Error starting scraper:', error);
    return next(error);
  }
});

// Start scheduled scraping
router.post('/schedule', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // For now, this is a placeholder as the Orchestrator doesn't have built-in scheduling yet
    // This would typically be handled by a separate cron service calling the API or Orchestrator
    req.body.intervalHours = req.body.intervalHours || 24;

    res.json({
      success: true,
      message: `Scheduled scraping configuration updated (Logic to be implemented in SchedulerService)`
    });
  } catch (error) {
    logger.error('Error starting scheduled scraping:', error);
    next(error);
  }
});

export default router;
