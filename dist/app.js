"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv = __importStar(require("dotenv"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const cities_routes_1 = __importDefault(require("./routes/cities.routes"));
const venues_routes_1 = __importDefault(require("./routes/venues.routes"));
const lists_routes_1 = __importDefault(require("./routes/lists.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const search_routes_1 = __importDefault(require("./routes/search.routes"));
const recommendations_routes_1 = __importDefault(require("./routes/recommendations.routes"));
const scraper_routes_1 = __importDefault(require("./routes/scraper.routes"));
const monitoring_service_1 = require("./services/monitoring.service");
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../.env.local', override: true });
const app = (0, express_1.default)();
const monitoring = monitoring_service_1.MonitoringService.getInstance();
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || 'http://localhost:3005',
    credentials: true
}));
app.use((0, compression_1.default)());
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use(monitoring.trackRequest());
app.use('/api', limiter);
app.get('/health', async (_req, res) => {
    const healthStatus = await monitoring.getHealthStatus();
    res.json({
        status: healthStatus.status,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        metrics: healthStatus.metrics,
        issues: healthStatus.issues
    });
});
app.get('/metrics', async (_req, res) => {
    const metrics = await monitoring.getMetrics('hour');
    res.json(metrics);
});
app.use('/api/auth', auth_routes_1.default);
app.use('/api/cities', cities_routes_1.default);
app.use('/api/venues', venues_routes_1.default);
app.use('/api/lists', lists_routes_1.default);
app.use('/api/user', user_routes_1.default);
app.use('/api/search', search_routes_1.default);
app.use('/api/recommendations', recommendations_routes_1.default);
app.use('/api/scraper', scraper_routes_1.default);
app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' });
});
app.use((err, _req, res, _next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});
exports.default = app;
//# sourceMappingURL=app.js.map