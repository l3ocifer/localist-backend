import { Request, Response, NextFunction } from 'express';

interface PerformanceMetrics {
  endpoint: string;
  method: string;
  duration: number;
  timestamp: Date;
  statusCode: number;
}

const metrics: PerformanceMetrics[] = [];

export const performanceMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    metrics.push({
      endpoint: req.path,
      method: req.method,
      duration,
      timestamp: new Date(),
      statusCode: res.statusCode
    });
    
    // Log slow requests
    if (duration > 1000) {
      console.warn(`Slow request: ${req.method} ${req.path} took ${duration}ms`);
    }
  });
  
  next();
};

export const getMetrics = () => metrics;
export const clearMetrics = () => metrics.length = 0;
