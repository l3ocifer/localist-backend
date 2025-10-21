import { createServer } from 'http';
import app from './app';
import { WebSocketService } from './services/websocket.service';
import { VenueScraperService } from './services/venue-scraper.service';
import GracefulShutdown from './utils/graceful-shutdown';
import logger from './services/logger.service';

const PORT = process.env.PORT || 3001;
const server = createServer(app);

// Initialize WebSocket service
WebSocketService.initialize(server);

// Initialize venue scraper service
const scraperService = VenueScraperService.getInstance();
// Start scheduled scraping if in production
if (process.env.NODE_ENV === 'production') {
  scraperService.startScheduledScraping(24); // Run every 24 hours
  console.log(`⏰ Venue scraper scheduled to run every 24 hours`);
}

// Initialize graceful shutdown
new GracefulShutdown(server);

server.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API Health Check: http://localhost:${PORT}/health`);
  console.log(`📊 Metrics Dashboard: http://localhost:${PORT}/metrics`);
  console.log(`🔌 WebSocket Server: ws://localhost:${PORT}`);
  console.log(`🔍 Venue Scraper: ${process.env.NODE_ENV === 'production' ? 'Active' : 'Inactive (dev mode)'}`);
});