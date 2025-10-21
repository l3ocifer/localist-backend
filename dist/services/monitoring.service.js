"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoringService = void 0;
const cache_service_1 = require("./cache.service");
class MonitoringService {
    static instance;
    cache;
    metricsBuffer = [];
    flushInterval;
    constructor() {
        this.cache = cache_service_1.CacheService.getInstance();
        // Flush metrics buffer every 10 seconds
        this.flushInterval = setInterval(() => {
            this.flushMetrics();
        }, 10000);
    }
    static getInstance() {
        if (!MonitoringService.instance) {
            MonitoringService.instance = new MonitoringService();
        }
        return MonitoringService.instance;
    }
    /**
     * Express middleware for tracking request metrics
     */
    trackRequest() {
        return (req, res, next) => {
            const startTime = Date.now();
            const originalSend = res.send;
            res.send = function (data) {
                const responseTime = Date.now() - startTime;
                const metric = {
                    endpoint: req.path,
                    method: req.method,
                    statusCode: res.statusCode,
                    responseTime,
                    timestamp: new Date(),
                    userId: req.userId,
                };
                if (res.statusCode >= 400) {
                    try {
                        const errorData = JSON.parse(data);
                        metric.errorMessage = errorData.error || errorData.message;
                    }
                    catch {
                        metric.errorMessage = 'Unknown error';
                    }
                }
                MonitoringService.getInstance().recordMetric(metric);
                return originalSend.call(this, data);
            };
            next();
        };
    }
    /**
     * Record a metric
     */
    recordMetric(metric) {
        this.metricsBuffer.push(metric);
        // Immediate flush if buffer is getting large
        if (this.metricsBuffer.length >= 100) {
            this.flushMetrics();
        }
    }
    /**
     * Flush metrics to cache/storage
     */
    async flushMetrics() {
        if (this.metricsBuffer.length === 0)
            return;
        const metrics = [...this.metricsBuffer];
        this.metricsBuffer = [];
        for (const metric of metrics) {
            // Store in Redis for real-time analytics
            const hourKey = this.getHourKey(metric.timestamp);
            // Increment request counter
            await this.cache.increment(`metrics:requests:${hourKey}`, 1);
            // Track response times
            await this.cache.zadd(`metrics:response_times:${hourKey}`, metric.responseTime, `${metric.endpoint}:${metric.method}`);
            // Track errors
            if (metric.statusCode >= 400) {
                await this.cache.increment(`metrics:errors:${hourKey}`, 1);
                await this.cache.hset(`metrics:error_details:${hourKey}`, `${metric.endpoint}:${metric.statusCode}`, metric.errorMessage || 'Unknown');
            }
            // Track unique users
            if (metric.userId) {
                await this.cache.zadd(`metrics:active_users:${hourKey}`, Date.now(), metric.userId);
            }
            // Track endpoint-specific metrics
            await this.cache.increment(`metrics:endpoint:${metric.endpoint}:${metric.method}:${hourKey}`, 1);
        }
    }
    /**
     * Get performance metrics for dashboard
     */
    async getMetrics(_timeRange = 'hour') {
        const currentHour = this.getHourKey(new Date());
        // Get total requests
        const totalRequests = await this.cache.get(`metrics:requests:${currentHour}`) || 0;
        // Get error count
        const errorCount = await this.cache.get(`metrics:errors:${currentHour}`) || 0;
        // Get response times
        const responseTimes = await this.cache.zrevrange(`metrics:response_times:${currentHour}`, 0, -1);
        // Calculate average response time
        let totalResponseTime = 0;
        const endpointTimes = new Map();
        for (let i = 0; i < responseTimes.length; i += 2) {
            const endpoint = responseTimes[i];
            const time = parseFloat(responseTimes[i + 1] || '0');
            totalResponseTime += time;
            if (!endpointTimes.has(endpoint)) {
                endpointTimes.set(endpoint, []);
            }
            endpointTimes.get(endpoint).push(time);
        }
        const averageResponseTime = totalRequests > 0
            ? totalResponseTime / totalRequests
            : 0;
        // Get slowest endpoints
        const slowestEndpoints = Array.from(endpointTimes.entries())
            .map(([endpoint, times]) => ({
            endpoint,
            avgTime: times.reduce((a, b) => a + b, 0) / times.length
        }))
            .sort((a, b) => b.avgTime - a.avgTime)
            .slice(0, 5);
        // Get error details
        const errorDetails = await this.cache.hgetall(`metrics:error_details:${currentHour}`) || {};
        const errorCounts = new Map();
        Object.entries(errorDetails).forEach(([_key, error]) => {
            errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
        });
        const mostFrequentErrors = Array.from(errorCounts.entries())
            .map(([error, count]) => ({ error, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        // Get active users count
        const activeUsers = (await this.cache.zrevrange(`metrics:active_users:${currentHour}`, 0, -1)).length;
        return {
            totalRequests,
            averageResponseTime: Math.round(averageResponseTime),
            errorRate: totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0,
            requestsPerMinute: Math.round(totalRequests / 60),
            slowestEndpoints,
            mostFrequentErrors,
            activeUsers,
        };
    }
    /**
     * Get health status
     */
    async getHealthStatus() {
        const metrics = await this.getMetrics();
        const issues = [];
        let status = 'healthy';
        // Check error rate
        if (metrics.errorRate > 10) {
            issues.push(`High error rate: ${metrics.errorRate.toFixed(2)}%`);
            status = 'unhealthy';
        }
        else if (metrics.errorRate > 5) {
            issues.push(`Elevated error rate: ${metrics.errorRate.toFixed(2)}%`);
            status = 'degraded';
        }
        // Check response time
        if (metrics.averageResponseTime > 1000) {
            issues.push(`Slow response time: ${metrics.averageResponseTime}ms`);
            status = status === 'healthy' ? 'degraded' : status;
        }
        // Check for specific endpoint issues
        const verySlowEndpoints = metrics.slowestEndpoints.filter(e => e.avgTime > 2000);
        if (verySlowEndpoints.length > 0) {
            issues.push(`Very slow endpoints: ${verySlowEndpoints.map(e => e.endpoint).join(', ')}`);
            status = status === 'healthy' ? 'degraded' : status;
        }
        return {
            status,
            metrics,
            issues,
        };
    }
    /**
     * Track custom event
     */
    async trackEvent(event, data, userId) {
        const timestamp = new Date();
        const hourKey = this.getHourKey(timestamp);
        await this.cache.increment(`events:${event}:${hourKey}`, 1);
        if (userId) {
            await this.cache.zadd(`events:${event}:users:${hourKey}`, Date.now(), userId);
        }
        // Store event details
        await this.cache.hset(`events:${event}:details:${hourKey}`, timestamp.toISOString(), JSON.stringify(data));
    }
    /**
     * Track database query performance
     */
    async trackDatabaseQuery(query, duration, success) {
        const hourKey = this.getHourKey(new Date());
        await this.cache.increment(`db:queries:${hourKey}`, 1);
        await this.cache.zadd(`db:query_times:${hourKey}`, duration, query.substring(0, 100));
        if (!success) {
            await this.cache.increment(`db:errors:${hourKey}`, 1);
        }
    }
    /**
     * Get hour key for metrics aggregation
     */
    getHourKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        return `${year}${month}${day}:${hour}`;
    }
    /**
     * Clean up old metrics
     */
    async cleanupOldMetrics(hoursToKeep = 24) {
        const cutoffTime = new Date();
        cutoffTime.setHours(cutoffTime.getHours() - hoursToKeep);
        // Generate list of old hour keys to delete
        const oldKeys = [];
        for (let i = hoursToKeep + 1; i <= hoursToKeep + 24; i++) {
            const oldDate = new Date();
            oldDate.setHours(oldDate.getHours() - i);
            const hourKey = this.getHourKey(oldDate);
            oldKeys.push(`metrics:requests:${hourKey}`, `metrics:errors:${hourKey}`, `metrics:response_times:${hourKey}`, `metrics:error_details:${hourKey}`, `metrics:active_users:${hourKey}`);
        }
        // Delete old keys
        for (const key of oldKeys) {
            await this.cache.delete(key);
        }
    }
    /**
     * Shutdown monitoring service
     */
    shutdown() {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }
        this.flushMetrics();
    }
}
exports.MonitoringService = MonitoringService;
//# sourceMappingURL=monitoring.service.js.map