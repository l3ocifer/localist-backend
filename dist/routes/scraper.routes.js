"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const venue_scraper_service_1 = require("../services/venue-scraper.service");
const logger_service_1 = __importDefault(require("../services/logger.service"));
const router = (0, express_1.Router)();
const scraperService = venue_scraper_service_1.VenueScraperService.getInstance();
// Get scraper status
router.get('/status', async (_req, res, next) => {
    try {
        const status = scraperService.getStatus();
        res.json({
            success: true,
            data: status
        });
    }
    catch (error) {
        logger_service_1.default.error('Error getting scraper status:', error);
        next(error);
    }
});
// Manually trigger scraping for a specific city
router.post('/scrape/:cityId', async (req, res, next) => {
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
            logger_service_1.default.info(`Scraping completed for ${cityId}: ${count} venues added`);
        })
            .catch(error => {
            logger_service_1.default.error(`Scraping failed for ${cityId}:`, error);
        });
        return res.json({
            success: true,
            message: `Scraping started for city ${cityId}`,
            category: category || 'all'
        });
    }
    catch (error) {
        logger_service_1.default.error('Error starting scraper:', error);
        return next(error);
    }
});
// Trigger scraping for all cities
router.post('/scrape-all', async (_req, res, next) => {
    try {
        // Run scraping asynchronously
        scraperService.scrapeAllCities()
            .then(() => {
            logger_service_1.default.info('Scraping completed for all cities');
        })
            .catch(error => {
            logger_service_1.default.error('Scraping failed:', error);
        });
        res.json({
            success: true,
            message: 'Scraping started for all cities'
        });
    }
    catch (error) {
        logger_service_1.default.error('Error starting scraper:', error);
        return next(error);
    }
});
// Start scheduled scraping
router.post('/schedule', async (req, res, next) => {
    try {
        const { intervalHours = 24 } = req.body;
        scraperService.startScheduledScraping(intervalHours);
        res.json({
            success: true,
            message: `Scheduled scraping started with ${intervalHours} hour interval`
        });
    }
    catch (error) {
        logger_service_1.default.error('Error starting scheduled scraping:', error);
        next(error);
    }
});
exports.default = router;
//# sourceMappingURL=scraper.routes.js.map