"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
const config_1 = __importDefault(require("../config"));
const logLevels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6
};
class LoggerService {
    logger;
    static instance;
    constructor() {
        const logDir = path_1.default.join(__dirname, '../../../logs');
        const transports = [
            new winston_1.default.transports.Console({
                format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
            })
        ];
        // Add file transports in production
        if (config_1.default.isProduction) {
            transports.push(new winston_1.default.transports.File({
                filename: path_1.default.join(logDir, 'error.log'),
                level: 'error',
                maxsize: 5242880, // 5MB
                maxFiles: 5,
            }), new winston_1.default.transports.File({
                filename: path_1.default.join(logDir, 'combined.log'),
                maxsize: 5242880, // 5MB
                maxFiles: 5,
            }));
        }
        this.logger = winston_1.default.createLogger({
            level: process.env.LOG_LEVEL || (config_1.default.isDevelopment ? 'debug' : 'info'),
            levels: logLevels,
            format: winston_1.default.format.combine(winston_1.default.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss'
            }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.splat(), winston_1.default.format.json()),
            transports,
            exitOnError: false
        });
    }
    static getInstance() {
        if (!LoggerService.instance) {
            LoggerService.instance = new LoggerService();
        }
        return LoggerService.instance;
    }
    error(message, meta) {
        this.logger.error(message, meta);
    }
    warn(message, meta) {
        this.logger.warn(message, meta);
    }
    info(message, meta) {
        this.logger.info(message, meta);
    }
    http(message, meta) {
        this.logger.http(message, meta);
    }
    debug(message, meta) {
        this.logger.debug(message, meta);
    }
    // Log API request
    logRequest(req, res, responseTime) {
        const message = `${req.method} ${req.originalUrl}`;
        const meta = {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            responseTime: `${responseTime}ms`,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            userId: req.userId || 'anonymous'
        };
        if (res.statusCode >= 500) {
            this.error(message, meta);
        }
        else if (res.statusCode >= 400) {
            this.warn(message, meta);
        }
        else {
            this.http(message, meta);
        }
    }
    // Log database query
    logQuery(query, duration, success) {
        const meta = {
            query: query.substring(0, 200),
            duration: `${duration}ms`,
            success
        };
        if (!success) {
            this.error('Database query failed', meta);
        }
        else if (duration > 1000) {
            this.warn('Slow database query', meta);
        }
        else {
            this.debug('Database query', meta);
        }
    }
    // Log error with stack trace
    logError(error, context) {
        this.error(error.message, {
            stack: error.stack,
            context,
            timestamp: new Date().toISOString()
        });
    }
    // Stream for Morgan HTTP logger
    stream = {
        write: (message) => {
            this.http(message.trim());
        }
    };
}
exports.logger = LoggerService.getInstance();
exports.default = exports.logger;
//# sourceMappingURL=logger.service.js.map