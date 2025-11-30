import { NextFunction, Request, Response, Router } from 'express';
import pool from '../config/database';
import logger from '../services/logger.service';
import { PerplexicaScraperService } from '../services/perplexica-scraper.service';
import { ScraperOrchestratorService } from '../services/scraper-orchestrator.service';
import { SearXNGService } from '../services/searxng.service';
import { UnifiedScraperService } from '../services/unified-scraper.service';

const router = Router();
const scraperOrchestrator = ScraperOrchestratorService.getInstance();
const unifiedScraper = UnifiedScraperService.getInstance();
const perplexicaService = PerplexicaScraperService.getInstance();
const searxng = SearXNGService.getInstance();

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

// =============================================================================
// UNIFIED SCRAPER ROUTES (Multi-Source Hybrid Pipeline)
// =============================================================================

/**
 * GET /api/scraper/unified/status
 * Get status of all scraping services
 */
router.get('/unified/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const serviceStatus = await unifiedScraper.getServiceStatus();
    const activeJobs = await scraperOrchestrator.getActiveJobsCount();

    res.json({
      success: true,
      data: {
        services: {
          google: {
            configured: serviceStatus.google,
            status: serviceStatus.google ? 'ready' : 'not_configured',
          },
          perplexity: {
            configured: serviceStatus.perplexity,
            status: serviceStatus.perplexity ? 'ready' : 'not_configured',
          },
          searxng: {
            configured: true,
            status: serviceStatus.searxng ? 'healthy' : 'unreachable',
          },
        },
        activeJobs,
        recommendation:
          !serviceStatus.google && !serviceStatus.perplexity
            ? 'Configure GOOGLE_PLACES_API_KEY or PERPLEXITY_API_KEY for full functionality'
            : 'All recommended services available',
      },
    });
  } catch (error: any) {
    logger.error('Error getting unified scraper status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/scraper/unified/scrape/:cityId
 * Run the full unified scraping pipeline for a city
 */
router.post('/unified/scrape/:cityId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cityId } = req.params;
    const {
      useGoogle = true,
      usePerplexity = true,
      useSearxng = true,
      categories,
      enrichTopN = 50,
      dryRun = false,
    } = req.body;

    if (!cityId) {
      res.status(400).json({ error: 'cityId is required' });
      return;
    }

    // Verify city exists
    const cityResult = await pool.query('SELECT name FROM cities WHERE id = $1', [cityId]);
    if (cityResult.rows.length === 0) {
      res.status(404).json({ error: 'City not found' });
      return;
    }

    const cityName = cityResult.rows[0].name;

    // Run scraping in background
    unifiedScraper
      .scrapeCity(cityId, {
        useGoogle,
        usePerplexity,
        useSearxng,
        categories,
        enrichTopN,
        dryRun,
      })
      .then((result) => {
        logger.info(`Unified scraping complete for ${cityName}:`, result);
      })
      .catch((error) => {
        logger.error(`Unified scraping failed for ${cityName}:`, error);
      });

    res.json({
      success: true,
      message: `Unified scraping started for ${cityName}`,
      cityId,
      options: { useGoogle, usePerplexity, useSearxng, categories, enrichTopN, dryRun },
      status: 'running',
    });
  } catch (error: any) {
    logger.error('Error starting unified scraper:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/scraper/unified/discover/:cityId
 * Discover new venues using AI
 */
router.post('/unified/discover/:cityId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cityId } = req.params;
    const { focusOn = 'hidden_gems', category = 'restaurants and bars', limit = 20 } = req.body;

    if (!cityId) {
      res.status(400).json({ error: 'cityId is required' });
      return;
    }

    const result = await unifiedScraper.discoverNewVenues(cityId, {
      focusOn,
      category,
      limit,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    logger.error('Error discovering venues:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/scraper/unified/enrich/:venueId
 * Enrich a single venue with AI-generated content
 */
router.post('/unified/enrich/:venueId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { venueId } = req.params;

    const result = await unifiedScraper.enrichVenue(venueId);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      message: 'Venue enriched successfully',
      enrichment: result.enrichment,
    });
  } catch (error: any) {
    logger.error('Error enriching venue:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// PERPLEXITY API ROUTES (Production AI Search)
// =============================================================================

/**
 * POST /api/scraper/perplexity/discover
 * Discover venues using Perplexity API
 */
router.post('/perplexity/discover', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cityName, focusOn = 'best_of', category, limit = 20 } = req.body;

    if (!cityName) {
      res.status(400).json({ error: 'cityName is required' });
      return;
    }

    if (!perplexicaService.isConfigured()) {
      res.status(503).json({
        error: 'Perplexity API not configured',
        help: 'Set PERPLEXITY_API_KEY environment variable',
      });
      return;
    }

    const result = await perplexicaService.discoverVenues(cityName, {
      focusOn,
      category,
      limit,
    });

    res.json({
      success: true,
      cityName,
      venues: result.venues,
      sources: result.sources,
      venueCount: result.venues.length,
    });
  } catch (error: any) {
    logger.error('Perplexity discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/scraper/perplexity/enrich
 * Enrich venue data using Perplexity API
 */
router.post('/perplexity/enrich', async (req: Request, res: Response): Promise<void> => {
  try {
    const { venueName, cityName, address, cuisine, category } = req.body;

    if (!venueName || !cityName) {
      res.status(400).json({ error: 'venueName and cityName are required' });
      return;
    }

    if (!perplexicaService.isConfigured()) {
      res.status(503).json({
        error: 'Perplexity API not configured',
        help: 'Set PERPLEXITY_API_KEY environment variable',
      });
      return;
    }

    const result = await perplexicaService.enrichVenue(venueName, cityName, {
      address,
      cuisine,
      category,
    });

    res.json({
      success: true,
      venueName,
      enrichment: result,
    });
  } catch (error: any) {
    logger.error('Perplexity enrichment error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/scraper/perplexity/lists
 * Find Best-Of lists for a city
 */
router.post('/perplexity/lists', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cityName, year } = req.body;

    if (!cityName) {
      res.status(400).json({ error: 'cityName is required' });
      return;
    }

    if (!perplexicaService.isConfigured()) {
      res.status(503).json({
        error: 'Perplexity API not configured',
        help: 'Set PERPLEXITY_API_KEY environment variable',
      });
      return;
    }

    const result = await perplexicaService.findBestOfLists(cityName, year);

    res.json({
      success: true,
      cityName,
      lists: result.lists,
      sources: result.sources,
    });
  } catch (error: any) {
    logger.error('Perplexity lists error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// SEARXNG ROUTES (Free Meta Search)
// =============================================================================

/**
 * GET /api/scraper/searxng/status
 * Check SearXNG availability
 */
router.get('/searxng/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const isAvailable = await searxng.isAvailable();

    res.json({
      success: true,
      searxng: {
        url: process.env.SEARXNG_URL || 'http://localhost:8080',
        available: isAvailable,
        status: isAvailable ? 'healthy' : 'unreachable',
      },
    });
  } catch (error: any) {
    logger.error('SearXNG status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/scraper/searxng/search
 * General search using SearXNG
 */
router.post('/searxng/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, categories, engines, timeRange, limit = 20 } = req.body;

    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const result = await searxng.search(query, {
      categories,
      engines,
      timeRange,
      limit,
    });

    res.json({
      success: true,
      query: result.query,
      resultCount: result.number_of_results,
      results: result.results,
      suggestions: result.suggestions,
    });
  } catch (error: any) {
    logger.error('SearXNG search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/scraper/searxng/editorial-lists
 * Find editorial Best-Of lists for a city
 */
router.post('/searxng/editorial-lists', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cityName, year, category } = req.body;

    if (!cityName) {
      res.status(400).json({ error: 'cityName is required' });
      return;
    }

    const lists = await searxng.findEditorialLists(cityName, { year, category });

    res.json({
      success: true,
      cityName,
      lists,
      listCount: lists.length,
    });
  } catch (error: any) {
    logger.error('SearXNG editorial lists error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/scraper/searxng/new-openings
 * Find new restaurant/bar openings
 */
router.post('/searxng/new-openings', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cityName, timeRange = 'month', category = 'restaurant' } = req.body;

    if (!cityName) {
      res.status(400).json({ error: 'cityName is required' });
      return;
    }

    const openings = await searxng.findNewOpenings(cityName, { timeRange, category });

    res.json({
      success: true,
      cityName,
      openings,
      count: openings.length,
    });
  } catch (error: any) {
    logger.error('SearXNG new openings error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/scraper/searxng/press-mentions
 * Find press mentions for a venue
 */
router.post('/searxng/press-mentions', async (req: Request, res: Response): Promise<void> => {
  try {
    const { venueName, cityName, limit = 20 } = req.body;

    if (!venueName || !cityName) {
      res.status(400).json({ error: 'venueName and cityName are required' });
      return;
    }

    const mentions = await searxng.findPressMentions(venueName, cityName, { limit });

    res.json({
      success: true,
      venueName,
      cityName,
      mentions,
      count: mentions.length,
    });
  } catch (error: any) {
    logger.error('SearXNG press mentions error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
