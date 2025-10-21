import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import * as dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.routes';
import citiesRoutes from './routes/cities.routes';
import venuesRoutes from './routes/venues.routes';
import listsRoutes from './routes/lists.routes';
import userRoutes from './routes/user.routes';
import searchRoutes from './routes/search.routes';
import recommendationsRoutes from './routes/recommendations.routes';
import scraperRoutes from './routes/scraper.routes';
import { MonitoringService } from './services/monitoring.service';

dotenv.config({ path: '../.env' });
dotenv.config({ path: '../.env.local', override: true });

const app: Application = express();
const monitoring = MonitoringService.getInstance();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3005',
  credentials: true
}));
app.use(compression());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(monitoring.trackRequest());
app.use('/api', limiter);

app.get('/health', async (_req: Request, res: Response) => {
  const healthStatus = await monitoring.getHealthStatus();
  res.json({ 
    status: healthStatus.status,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    metrics: healthStatus.metrics,
    issues: healthStatus.issues
  });
});

app.get('/metrics', async (_req: Request, res: Response) => {
  const metrics = await monitoring.getMetrics('hour');
  res.json(metrics);
});

app.use('/api/auth', authRoutes);
app.use('/api/cities', citiesRoutes);
app.use('/api/venues', venuesRoutes);
app.use('/api/lists', listsRoutes);
app.use('/api/user', userRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/recommendations', recommendationsRoutes);
app.use('/api/scraper', scraperRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

export default app;