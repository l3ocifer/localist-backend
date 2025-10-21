import winston from 'winston';
import path from 'path';
import config from '../config';

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
  private logger: winston.Logger;
  private static instance: LoggerService;

  private constructor() {
    const logDir = path.join(__dirname, '../../../logs');
    
    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ];

    // Add file transports in production
    if (config.isProduction) {
      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
        new winston.transports.File({
          filename: path.join(logDir, 'combined.log'),
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        })
      );
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || (config.isDevelopment ? 'debug' : 'info'),
      levels: logLevels,
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
      ),
      transports,
      exitOnError: false
    });
  }

  static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService();
    }
    return LoggerService.instance;
  }

  error(message: string, meta?: any): void {
    this.logger.error(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  http(message: string, meta?: any): void {
    this.logger.http(message, meta);
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  // Log API request
  logRequest(req: any, res: any, responseTime: number): void {
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
    } else if (res.statusCode >= 400) {
      this.warn(message, meta);
    } else {
      this.http(message, meta);
    }
  }

  // Log database query
  logQuery(query: string, duration: number, success: boolean): void {
    const meta = {
      query: query.substring(0, 200),
      duration: `${duration}ms`,
      success
    };

    if (!success) {
      this.error('Database query failed', meta);
    } else if (duration > 1000) {
      this.warn('Slow database query', meta);
    } else {
      this.debug('Database query', meta);
    }
  }

  // Log error with stack trace
  logError(error: Error, context?: string): void {
    this.error(error.message, {
      stack: error.stack,
      context,
      timestamp: new Date().toISOString()
    });
  }

  // Stream for Morgan HTTP logger
  stream = {
    write: (message: string) => {
      this.http(message.trim());
    }
  };
}

export const logger = LoggerService.getInstance();
export default logger;