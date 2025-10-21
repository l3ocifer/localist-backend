import { Request, Response, NextFunction } from 'express';
interface PerformanceMetrics {
    totalRequests: number;
    averageResponseTime: number;
    errorRate: number;
    requestsPerMinute: number;
    slowestEndpoints: Array<{
        endpoint: string;
        avgTime: number;
    }>;
    mostFrequentErrors: Array<{
        error: string;
        count: number;
    }>;
    activeUsers: number;
}
export declare class MonitoringService {
    private static instance;
    private cache;
    private metricsBuffer;
    private flushInterval;
    private constructor();
    static getInstance(): MonitoringService;
    /**
     * Express middleware for tracking request metrics
     */
    trackRequest(): (req: Request, res: Response, next: NextFunction) => void;
    /**
     * Record a metric
     */
    private recordMetric;
    /**
     * Flush metrics to cache/storage
     */
    private flushMetrics;
    /**
     * Get performance metrics for dashboard
     */
    getMetrics(_timeRange?: 'hour' | 'day' | 'week'): Promise<PerformanceMetrics>;
    /**
     * Get health status
     */
    getHealthStatus(): Promise<{
        status: 'healthy' | 'degraded' | 'unhealthy';
        metrics: PerformanceMetrics;
        issues: string[];
    }>;
    /**
     * Track custom event
     */
    trackEvent(event: string, data: Record<string, any>, userId?: string): Promise<void>;
    /**
     * Track database query performance
     */
    trackDatabaseQuery(query: string, duration: number, success: boolean): Promise<void>;
    /**
     * Get hour key for metrics aggregation
     */
    private getHourKey;
    /**
     * Clean up old metrics
     */
    cleanupOldMetrics(hoursToKeep?: number): Promise<void>;
    /**
     * Shutdown monitoring service
     */
    shutdown(): void;
}
export {};
//# sourceMappingURL=monitoring.service.d.ts.map