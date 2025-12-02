import { readdir, readFile } from 'fs/promises';
import { createServer } from 'http';
import { join } from 'path';
import app from './app';
import pool from './config/database';
import logger from './services/logger.service';
import { WebSocketService } from './services/websocket.service';
import GracefulShutdown from './utils/graceful-shutdown';

const PORT = process.env.PORT || 3001;

// Run database migrations on startup if enabled
async function runMigrations(): Promise<void> {
  if (process.env.RUN_MIGRATIONS !== 'true') {
    logger.info('Migrations disabled (RUN_MIGRATIONS != true)');
    return;
  }

  try {
    logger.info('📋 Running database migrations...');
    // Handle both Docker (/app/database/migrations) and local development
    const dockerPath = '/app/database/migrations';
    const localPath = join(__dirname, '../../database/migrations');
    const migrationsDir = require('fs').existsSync(dockerPath) ? dockerPath : localPath;
    logger.info(`📂 Using migrations from: ${migrationsDir}`);
    const files = await readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

    for (const file of sqlFiles) {
      const filePath = join(migrationsDir, file);
      const sql = await readFile(filePath, 'utf-8');

      try {
        await pool.query(sql);
        logger.info(`✅ Applied migration: ${file}`);
      } catch (error: any) {
        // Ignore "already exists" errors (migrations are idempotent)
        if (
          error.message?.includes('already exists') ||
          error.message?.includes('does not exist')
        ) {
          logger.debug(`⏭️  Skipped migration ${file} (already applied)`);
        } else {
          logger.error(`❌ Failed to apply migration ${file}:`, error.message);
          throw error;
        }
      }
    }

    logger.info('✅ All migrations complete');
  } catch (error: any) {
    logger.error('❌ Migration error:', error);
    throw error;
  }
}

// Wait for database and run migrations before starting server
async function startServer(): Promise<void> {
  // Wait for database connection
  let retries = 30;
  while (retries > 0) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (error) {
      retries--;
      if (retries === 0) {
        logger.error('❌ Database connection timeout');
        process.exit(1);
      }
      logger.info(`⏳ Waiting for database... (${30 - retries}/30)`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Run migrations
  await runMigrations();

  // Start server
  const server = createServer(app);

  // Initialize WebSocket service
  WebSocketService.initialize(server);

  // Note: Scheduled scraping removed - use /api/scraper/google/scrape/:cityId endpoint
  // or run scripts/scrape-venues-to-json.ts manually

  // Initialize graceful shutdown
  new GracefulShutdown(server);

  server.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 API Health Check: http://localhost:${PORT}/health`);
    console.log(`📊 Metrics Dashboard: http://localhost:${PORT}/metrics`);
    console.log(`🔌 WebSocket Server: ws://localhost:${PORT}`);
    console.log(
      `🔍 Venue Scraper: ${
        process.env.NODE_ENV === 'production' ? 'Active' : 'Inactive (dev mode)'
      }`
    );
  });
}

// Start the application
startServer().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
