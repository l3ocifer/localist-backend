"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GracefulShutdown = void 0;
const database_1 = __importDefault(require("../config/database"));
const cache_service_1 = require("../services/cache.service");
const monitoring_service_1 = require("../services/monitoring.service");
const logger_service_1 = __importDefault(require("../services/logger.service"));
class GracefulShutdown {
    server;
    isShuttingDown = false;
    connections = new Set();
    constructor(server) {
        this.server = server;
        this.setupHandlers();
        this.trackConnections();
    }
    setupHandlers() {
        // Handle different shutdown signals
        process.on('SIGTERM', () => this.shutdown('SIGTERM'));
        process.on('SIGINT', () => this.shutdown('SIGINT'));
        process.on('SIGUSR2', () => this.shutdown('SIGUSR2')); // Nodemon restart
        // Handle uncaught errors
        process.on('uncaughtException', (error) => {
            logger_service_1.default.error('Uncaught Exception:', error);
            this.shutdown('UNCAUGHT_EXCEPTION');
        });
        process.on('unhandledRejection', (reason, promise) => {
            logger_service_1.default.error('Unhandled Rejection at:', { promise, reason });
            this.shutdown('UNHANDLED_REJECTION');
        });
    }
    trackConnections() {
        this.server.on('connection', (connection) => {
            this.connections.add(connection);
            connection.on('close', () => {
                this.connections.delete(connection);
            });
        });
    }
    async shutdown(signal) {
        if (this.isShuttingDown) {
            return;
        }
        this.isShuttingDown = true;
        logger_service_1.default.info(`Graceful shutdown initiated by ${signal}`);
        // Stop accepting new connections
        this.server.close(async () => {
            logger_service_1.default.info('HTTP server closed');
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
            logger_service_1.default.info('Graceful shutdown completed');
            process.exit(0);
        }
        catch (error) {
            logger_service_1.default.error('Error during graceful shutdown:', error);
            process.exit(1);
        }
    }
    async cleanup() {
        const cleanupTasks = [];
        // Close database connections
        cleanupTasks.push(database_1.default.end()
            .then(() => logger_service_1.default.info('Database connections closed'))
            .catch(err => logger_service_1.default.error('Error closing database connections:', err)));
        // Close Redis connections
        cleanupTasks.push(cache_service_1.CacheService.getInstance().close()
            .then(() => logger_service_1.default.info('Redis connection closed'))
            .catch(err => logger_service_1.default.error('Error closing Redis connection:', err)));
        // Flush monitoring metrics
        try {
            monitoring_service_1.MonitoringService.getInstance().shutdown();
            logger_service_1.default.info('Monitoring metrics flushed');
        }
        catch (err) {
            logger_service_1.default.error('Error flushing monitoring metrics:', err);
        }
        await Promise.all(cleanupTasks);
    }
}
exports.GracefulShutdown = GracefulShutdown;
exports.default = GracefulShutdown;
//# sourceMappingURL=graceful-shutdown.js.map