import { NextFunction, Request, Response, Router } from 'express';
import pool from '../config/database';
import logger from '../services/logger.service';
import { PerplexicaScraperService } from '../services/perplexica-scraper.service';
import { ScraperOrchestratorService } from '../services/scraper-orchestrator.service';

const router = Router();
const scraperOrchestrator = ScraperOrchestratorService.getInstance();

// =============================================================================
// ORCHESTRATOR ROUTES (existing)
// =============================================================================

// Get scraper status (Active jobs count)
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const activeCount = await scraperOrchestrator.getActiveJobsCount();

    // Also check Perplexica status
    const perplexicaUrl = process.env.PERPLEXICA_URL || 'http://localhost:3002';
    let perplexicaStatus = 'unknown';
    try {
      const response = await fetch(perplexicaUrl);
      perplexicaStatus = response.ok ? 'healthy' : 'unhealthy';
    } catch {
      perplexicaStatus = 'unreachable';
    }

    res.json({
      success: true,
      data: {
        activeJobs: activeCount,
        isRunning: activeCount > 0,
        services: {
          orchestrator: 'healthy',
          perplexica: {
            url: perplexicaUrl,
            status: perplexicaStatus,
          },
        },
      },
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
        error: 'City ID is required',
      });
    }

    const jobId = await scraperOrchestrator.startScrapingJob(jobType || 'all_sources', {
      cityId,
      category,
    });

    return res.json({
      success: true,
      message: `Scraping started for city ${cityId}`,
      jobId,
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
      jobId,
    });
  } catch (error) {
    logger.error('Error starting scraper:', error);
    return next(error);
  }
});

// Start scheduled scraping
router.post('/schedule', async (req: Request, res: Response, next: NextFunction) => {
  try {
    req.body.intervalHours = req.body.intervalHours || 24;

    res.json({
      success: true,
      message: `Scheduled scraping configuration updated`,
    });
  } catch (error) {
    logger.error('Error starting scheduled scraping:', error);
    next(error);
  }
});

// =============================================================================
// PERPLEXICA AI SEARCH ROUTES (new)
// =============================================================================

/**
 * POST /api/scraper/perplexica/discover
 * Discover venues in a city using Perplexica AI search
 */
router.post('/perplexica/discover', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cityId } = req.body;

    if (!cityId) {
      res.status(400).json({ error: 'cityId is required' });
      return;
    }

    // Get city name
    const cityResult = await pool.query('SELECT name FROM cities WHERE id = $1', [cityId]);

    if (cityResult.rows.length === 0) {
      res.status(404).json({ error: 'City not found' });
      return;
    }

    const cityName = cityResult.rows[0].name;
    const scraper = PerplexicaScraperService.getInstance();

    // Run discovery in background
    scraper
      .runDiscoveryJob(cityId, cityName)
      .then((result) => {
        logger.info(`Perplexica discovery complete for ${cityName}:`, result);
      })
      .catch((error) => {
        logger.error(`Perplexica discovery failed for ${cityName}:`, error);
      });

    res.json({
      message: `Perplexica discovery job started for ${cityName}`,
      cityId,
      status: 'running',
    });
  } catch (error: any) {
    logger.error('Error starting Perplexica discovery:', error);
    res.status(500).json({ error: 'Failed to start discovery job' });
  }
});

/**
 * POST /api/scraper/perplexica/search
 * Direct search using Perplexica
 */
router.post('/perplexica/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, focusMode = 'webSearch' } = req.body;

    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const scraper = PerplexicaScraperService.getInstance();
    const result = await scraper.searchVenues(query, focusMode);

    res.json(result);
  } catch (error: any) {
    logger.error('Perplexica search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * POST /api/scraper/perplexica/enrich/:venueId
 * Enrich venue data using AI search
 */
router.post('/perplexica/enrich/:venueId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { venueId } = req.params;
    const scraper = PerplexicaScraperService.getInstance();

    const enrichedVenue = await scraper.enrichVenueData(venueId);

    if (!enrichedVenue) {
      res.status(404).json({ error: 'Venue not found' });
      return;
    }

    res.json({
      message: 'Venue enriched successfully',
      venue: enrichedVenue,
    });
  } catch (error: any) {
    logger.error('Venue enrichment error:', error);
    res.status(500).json({ error: 'Enrichment failed' });
  }
});

export default router;
