"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const app_1 = __importDefault(require("./app"));
const websocket_service_1 = require("./services/websocket.service");
const venue_scraper_service_1 = require("./services/venue-scraper.service");
const graceful_shutdown_1 = __importDefault(require("./utils/graceful-shutdown"));
const logger_service_1 = __importDefault(require("./services/logger.service"));
const PORT = process.env.PORT || 3001;
const server = (0, http_1.createServer)(app_1.default);
// Initialize WebSocket service
websocket_service_1.WebSocketService.initialize(server);
// Initialize venue scraper service
const scraperService = venue_scraper_service_1.VenueScraperService.getInstance();
// Start scheduled scraping if in production
if (process.env.NODE_ENV === 'production') {
    scraperService.startScheduledScraping(24); // Run every 24 hours
    console.log(`⏰ Venue scraper scheduled to run every 24 hours`);
}
// Initialize graceful shutdown
new graceful_shutdown_1.default(server);
server.listen(PORT, () => {
    logger_service_1.default.info(`Server started on port ${PORT}`);
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 API Health Check: http://localhost:${PORT}/health`);
    console.log(`📊 Metrics Dashboard: http://localhost:${PORT}/metrics`);
    console.log(`🔌 WebSocket Server: ws://localhost:${PORT}`);
    console.log(`🔍 Venue Scraper: ${process.env.NODE_ENV === 'production' ? 'Active' : 'Inactive (dev mode)'}`);
});
//# sourceMappingURL=index.js.map