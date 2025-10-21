"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearMetrics = exports.getMetrics = exports.performanceMiddleware = void 0;
const metrics = [];
const performanceMiddleware = (req, res, next) => {
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
exports.performanceMiddleware = performanceMiddleware;
const getMetrics = () => metrics;
exports.getMetrics = getMetrics;
const clearMetrics = () => metrics.length = 0;
exports.clearMetrics = clearMetrics;
//# sourceMappingURL=performance.js.map