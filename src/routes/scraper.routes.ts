import { Request, Response, Router } from 'express';
import pool from '../config/database';
import logger from '../services/logger.service';
import googlePlacesService, { DEFAULT_QUALITY_FILTERS } from '../services/google-places.service';
import { PerplexicaScraperService } from '../services/perplexica-scraper.service';
import { SearXNGService } from '../services/searxng.service';
import { ScrapingJobService } from '../services/scraping-job.service';

const router = Router();
const jobService = ScrapingJobService.getInstance();

// =============================================================================
// STATUS & HEALTH
// =============================================================================

/**
 * GET /api/scraper/status
 * Get status of all scraping services
 */
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const googleConfigured = googlePlacesService.isAvailable();
    
    // Check Perplexica
    const perplexicaUrl = process.env.PERPLEXICA_URL || 'http://localhost:3002';
    let perplexicaStatus = 'not_configured';
    try {
      const response = await fetch(perplexicaUrl);
      perplexicaStatus = response.ok ? 'healthy' : 'unhealthy';
    } catch {
      perplexicaStatus = 'unreachable';
    }

    // Check SearXNG
    const searxng = SearXNGService.getInstance();
    const searxngAvailable = await searxng.isAvailable();

    res.json({
      success: true,
      data: {
        services: {
          google_places: {
            configured: googleConfigured,
            status: googleConfigured ? 'ready' : 'not_configured',
            help: googleConfigured ? null : 'Set GOOGLE_MAPS_API_KEY',
          },
          perplexica: {
            url: perplexicaUrl,
            status: perplexicaStatus,
            help: 'Optional: AI-powered search via local Perplexica',
          },
          searxng: {
            url: process.env.SEARXNG_URL || 'http://localhost:8080',
            status: searxngAvailable ? 'healthy' : 'unreachable',
            help: 'Optional: Meta search engine',
          },
        },
        recommendation: googleConfigured
          ? 'Google Places API ready - use /api/scraper/google/scrape/:cityId'
          : 'Configure GOOGLE_MAPS_API_KEY for primary scraping',
      },
    });
  } catch (error) {
    logger.error('Error getting scraper status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// =============================================================================
// GOOGLE PLACES API (PRIMARY SCRAPER)
// =============================================================================

/**
 * POST /api/scraper/google/scrape/:cityId
 * Scrape venues for a city using Google Places API
 */
router.post('/google/scrape/:cityId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cityId } = req.params;
    const {
      category = 'restaurant',
      targetCount = 100,
      minRating = DEFAULT_QUALITY_FILTERS.minRating,
      minReviews = DEFAULT_QUALITY_FILTERS.minReviews,
      dryRun = false,
    } = req.body;

    if (!googlePlacesService.isAvailable()) {
      res.status(503).json({
        error: 'Google Places API not configured',
        help: 'Set GOOGLE_MAPS_API_KEY environment variable',
      });
      return;
    }

    // Verify city exists
    const cityResult = await pool.query('SELECT name FROM cities WHERE id = $1', [cityId]);
    if (cityResult.rows.length === 0) {
      res.status(404).json({ error: 'City not found' });
      return;
    }

    const cityName = cityResult.rows[0].name;

    // Create job record
    const jobId = await jobService.createJob('venue_scrape', {
      cityId,
      sourceId: 'google_places',
    });

    // Run scraping in background
    (async () => {
      try {
        await jobService.updateJobStatus(jobId, 'running');

        const venues = await googlePlacesService.discoverQualityVenues(cityId, {
          category: category as 'restaurant' | 'bar' | 'cafe',
          targetCount,
          qualityFilters: {
            minRating,
            minReviews,
            requirePhotos: true,
            requireContact: true,
            excludeClosed: true,
          },
          onProgress: (msg) => logger.info(`[${jobId}] ${msg}`),
        });

        let saved = 0;
        let duplicates = 0;

        if (!dryRun) {
          for (const venue of venues) {
            // Check for duplicate
            const existing = await pool.query(
              `SELECT id FROM venues WHERE google_place_id = $1 OR (LOWER(name) = LOWER($2) AND city_id = $3)`,
              [venue.google_place_id, venue.name, venue.city_id]
            );

            if (existing.rows.length > 0) {
              duplicates++;
              continue;
            }

            // Insert venue
            const id = `venue_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            await pool.query(
              `INSERT INTO venues (
                id, name, address, city_id, category, cuisine, price_range,
                description, website, phone, image_url, rating, review_count,
                coordinates, features, google_place_id, neighborhood, source,
                created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())`,
              [
                id, venue.name, venue.address, venue.city_id, venue.category,
                venue.cuisine, venue.price_range, venue.description, venue.website,
                venue.phone, venue.image_url, venue.rating, venue.review_count,
                JSON.stringify(venue.coordinates), JSON.stringify(venue.features),
                venue.google_place_id, venue.neighborhood, 'google_places',
              ]
            );
            saved++;
          }
        }

        await jobService.updateJobMetrics(jobId, {
          recordsFound: venues.length,
          recordsProcessed: venues.length,
          recordsAdded: saved,
          recordsUpdated: 0,
          recordsFailed: duplicates,
        });
        await jobService.updateJobStatus(jobId, 'completed');

        logger.info(`[${jobId}] Scraping complete: ${saved} saved, ${duplicates} duplicates`);
      } catch (error: any) {
        logger.error(`[${jobId}] Scraping failed:`, error);
        await jobService.updateJobStatus(jobId, 'failed', error.message);
      }
    })();

    res.json({
      success: true,
      message: `Scraping started for ${cityName}`,
      jobId,
      config: { cityId, category, targetCount, minRating, minReviews, dryRun },
    });
  } catch (error: any) {
    logger.error('Error starting Google scraper:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/scraper/jobs/:jobId
 * Get job status
 */
router.get('/jobs/:jobId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { jobId } = req.params;
    const job = await jobService.getJob(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({ success: true, data: job });
  } catch (error: any) {
    logger.error('Error getting job:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/scraper/jobs
 * List recent jobs
 */
router.get('/jobs', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const jobs = await jobService.getRecentJobs(limit);

    res.json({ success: true, data: jobs });
  } catch (error: any) {
    logger.error('Error listing jobs:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// PERPLEXICA AI SEARCH (FUTURE/OPTIONAL)
// =============================================================================

/**
 * POST /api/scraper/perplexica/search
 * Direct search using Perplexica AI
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
    res.status(500).json({ error: 'Search failed - is Perplexica running?' });
  }
});

/**
 * POST /api/scraper/perplexica/discover
 * Discover venues using AI search
 */
router.post('/perplexica/discover', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cityName, category, limit = 20 } = req.body;

    if (!cityName) {
      res.status(400).json({ error: 'cityName is required' });
      return;
    }

    const scraper = PerplexicaScraperService.getInstance();
    const result = await scraper.discoverVenues(cityName, { category, limit });

    res.json({
      success: true,
      venues: result.venues,
      sources: result.sources,
    });
  } catch (error: any) {
    logger.error('Perplexica discovery error:', error);
    res.status(500).json({ error: 'Discovery failed - is Perplexica running?' });
  }
});

// =============================================================================
// SEARXNG META SEARCH (FUTURE/OPTIONAL)
// =============================================================================

/**
 * GET /api/scraper/searxng/status
 * Check SearXNG availability
 */
router.get('/searxng/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const searxng = SearXNGService.getInstance();
    const isAvailable = await searxng.isAvailable();

    res.json({
      success: true,
      searxng: {
        url: process.env.SEARXNG_URL || 'http://localhost:8080',
        available: isAvailable,
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
    const { query, limit = 20 } = req.body;

    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const searxng = SearXNGService.getInstance();
    const result = await searxng.search(query, { limit });

    res.json({
      success: true,
      query: result.query,
      resultCount: result.number_of_results,
      results: result.results,
    });
  } catch (error: any) {
    logger.error('SearXNG search error:', error);
    res.status(500).json({ error: 'Search failed - is SearXNG running?' });
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

    const searxng = SearXNGService.getInstance();
    const lists = await searxng.findEditorialLists(cityName, { year, category });

    res.json({
      success: true,
      cityName,
      lists,
    });
  } catch (error: any) {
    logger.error('SearXNG editorial lists error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
