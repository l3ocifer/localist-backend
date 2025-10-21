import { Router, Request, Response, NextFunction } from 'express';
import { VenueScraperService } from '../services/venue-scraper.service';
import logger from '../services/logger.service';

const router = Router();
const scraperService = VenueScraperService.getInstance();

// Get scraper status
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = scraperService.getStatus();
    res.json({
      success: true,
      data: status
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
    const { category } = req.body;

    if (!cityId) {
      return res.status(400).json({
        success: false,
        error: 'City ID is required'
      });
    }

    // Run scraping asynchronously
    scraperService.scrapeVenues(cityId, category)
      .then(count => {
        logger.info(`Scraping completed for ${cityId}: ${count} venues added`);
      })
      .catch(error => {
        logger.error(`Scraping failed for ${cityId}:`, error);
      });

    return res.json({
      success: true,
      message: `Scraping started for city ${cityId}`,
      category: category || 'all'
    });
  } catch (error) {
    logger.error('Error starting scraper:', error);
    return next(error);
  }
});

// Trigger scraping for all cities
router.post('/scrape-all', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Run scraping asynchronously
    scraperService.scrapeAllCities()
      .then(() => {
        logger.info('Scraping completed for all cities');
      })
      .catch(error => {
        logger.error('Scraping failed:', error);
      });

    res.json({
      success: true,
      message: 'Scraping started for all cities'
    });
  } catch (error) {
    logger.error('Error starting scraper:', error);
    return next(error);
  }
});

// Start scheduled scraping
router.post('/schedule', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { intervalHours = 24 } = req.body;

    scraperService.startScheduledScraping(intervalHours);

    res.json({
      success: true,
      message: `Scheduled scraping started with ${intervalHours} hour interval`
    });
  } catch (error) {
    logger.error('Error starting scheduled scraping:', error);
    next(error);
  }
});

export default router;