import { Server } from 'http';
import pool from '../config/database';
import { CacheService } from '../services/cache.service';
import { MonitoringService } from '../services/monitoring.service';
import logger from '../services/logger.service';

export class GracefulShutdown {
  private server: Server;
  private isShuttingDown = false;
  private connections = new Set<any>();

  constructor(server: Server) {
    this.server = server;
    this.setupHandlers();
    this.trackConnections();
  }

  private setupHandlers(): void {
    // Handle different shutdown signals
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGUSR2', () => this.shutdown('SIGUSR2')); // Nodemon restart
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      this.shutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', { promise, reason });
      this.shutdown('UNHANDLED_REJECTION');
    });
  }

  private trackConnections(): void {
    this.server.on('connection', (connection) => {
      this.connections.add(connection);
      
      connection.on('close', () => {
        this.connections.delete(connection);
      });
    });
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info(`Graceful shutdown initiated by ${signal}`);

    // Stop accepting new connections
    this.server.close(async () => {
      logger.info('HTTP server closed');
    });

    // Close existing connections
    this.connections.forEach((connection) => {
      connection.end();
    });

    // Force close connections after timeout
    setTimeout(() => {
      this.connections.forEach((connection) => {
        connection.destroy();
      });
    }, 10000);

    try {
      // Cleanup tasks
      await this.cleanup();
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  private async cleanup(): Promise<void> {
    const cleanupTasks = [];

    // Close database connections
    cleanupTasks.push(
      pool.end()
        .then(() => logger.info('Database connections closed'))
        .catch(err => logger.error('Error closing database connections:', err))
    );

    // Close Redis connections
    cleanupTasks.push(
      CacheService.getInstance().close()
        .then(() => logger.info('Redis connection closed'))
        .catch(err => logger.error('Error closing Redis connection:', err))
    );

    // Flush monitoring metrics
    try {
      MonitoringService.getInstance().shutdown();
      logger.info('Monitoring metrics flushed');
    } catch (err) {
      logger.error('Error flushing monitoring metrics:', err);
    }

    await Promise.all(cleanupTasks);
  }
}

export default GracefulShutdown;