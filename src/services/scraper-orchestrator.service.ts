import pool from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { VenueScraperService } from './venue-scraper.service';
import logger from './logger.service';
import { EaterHunter } from '../agents/eater-hunter.agent';
import { InfatuationHunter } from '../agents/infatuation-hunter.agent';
import { ThrillistHunter } from '../agents/thrillist-hunter.agent';
import { HunterAgent } from '../agents/hunter.agent';

export interface ScrapingJobConfig {
  cityId?: string;
  category?: string;
  sources?: string[];
  maxVenues?: number;
}

export interface ScrapingJobStatus {
  id: string;
  jobType: string;
  cityId?: string;
  category?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  venuesFound: number;
  venuesAdded: number;
  venuesUpdated: number;
  venuesFailed: number;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export class ScraperOrchestratorService {
  private static instance: ScraperOrchestratorService;
  private activeJobs: Map<string, Promise<void>> = new Map();
  private venueScraper: VenueScraperService;
  private eaterHunter: EaterHunter;
  private infatuationHunter: InfatuationHunter;
  private thrillistHunter: ThrillistHunter;

  private constructor() {
    this.venueScraper = VenueScraperService.getInstance();
    this.eaterHunter = new EaterHunter(pool);
    this.infatuationHunter = new InfatuationHunter(pool);
    this.thrillistHunter = new ThrillistHunter(pool);
  }

  static getInstance(): ScraperOrchestratorService {
    if (!ScraperOrchestratorService.instance) {
      ScraperOrchestratorService.instance = new ScraperOrchestratorService();
    }
    return ScraperOrchestratorService.instance;
  }

  /**
   * Start a new scraping job
   */
  async startScrapingJob(
    jobType: string,
    config: ScrapingJobConfig = {}
  ): Promise<string> {
    const jobId = uuidv4();

    try {
      // Create job record
      await pool.query(
        `INSERT INTO scraping_jobs (
          id, job_type, city_id, category, status, config, created_at
        ) VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
        [jobId, jobType, config.cityId || null, config.category || null, JSON.stringify(config)]
      );

      // Start job asynchronously
      const jobPromise = this.executeScrapingJob(jobId, jobType, config);
      this.activeJobs.set(jobId, jobPromise);

      // Clean up when done
      jobPromise.finally(() => {
        this.activeJobs.delete(jobId);
      });

      logger.info(`Started scraping job ${jobId} of type ${jobType}`);
      return jobId;
    } catch (error) {
      logger.error('Failed to start scraping job', error);
      throw error;
    }
  }

  /**
   * Execute a scraping job
   */
  private async executeScrapingJob(
    jobId: string,
    jobType: string,
    config: ScrapingJobConfig
  ): Promise<void> {
    let venuesAdded = 0;
    let venuesUpdated = 0;
    let venuesFailed = 0;

    try {
      // Update status to running
      await pool.query(
        `UPDATE scraping_jobs 
         SET status = 'running', started_at = NOW() 
         WHERE id = $1`,
        [jobId]
      );

      logger.info(`Executing scraping job ${jobId} of type ${jobType}`);

      // Execute based on job type
      if (jobType === 'all_sources' || jobType === 'google_places' || jobType === 'yelp' || jobType === 'foursquare') {
        // Use existing venue scraper service (API sources)
        if (config.cityId) {
          const count = await this.venueScraper.scrapeVenues(config.cityId, config.category);
          venuesAdded = count;
        } else {
          await this.venueScraper.scrapeAllCities();
          // Note: scrapeAllCities doesn't return total count easily, logging handled internally
        }
      } else if (jobType === 'eater' || jobType === 'infatuation' || jobType === 'thrillist' || jobType === 'web_scrape') {
        // Web scraping jobs handled by hunter agents
        const results = await this.executeWebScrapingJob(jobType, config);
        venuesAdded = results.added;
        venuesFailed = results.failed;
      } else {
        throw new Error(`Unknown job type: ${jobType}`);
      }

      // Update job status to completed
      await pool.query(
        `UPDATE scraping_jobs 
         SET status = 'completed', 
             completed_at = NOW(),
             venues_added = $1,
             venues_updated = $2,
             venues_failed = $3
         WHERE id = $4`,
        [venuesAdded, venuesUpdated, venuesFailed, jobId]
      );

      logger.info(`Completed scraping job ${jobId}: ${venuesAdded} venues added`);
    } catch (error: any) {
      logger.error(`Scraping job ${jobId} failed`, error);

      // Update job status to failed
      await pool.query(
        `UPDATE scraping_jobs 
         SET status = 'failed', 
             completed_at = NOW(),
             error_message = $1,
             error_stack = $2,
             venues_added = $3,
             venues_updated = $4,
             venues_failed = $5
         WHERE id = $6`,
        [
          error.message,
          error.stack,
          venuesAdded,
          venuesUpdated,
          venuesFailed,
          jobId
        ]
      );
    }
  }

  /**
   * Execute web scraping job (Eater, Infatuation, Thrillist)
   */
  private async executeWebScrapingJob(
    jobType: string,
    config: ScrapingJobConfig
  ): Promise<{ added: number; failed: number }> {
    let added = 0;
    let failed = 0;

    // Determine which agents to run
    const agents: HunterAgent[] = [];
    
    if (jobType === 'eater' || (jobType === 'web_scrape' && (!config.sources || config.sources.includes('eater')))) {
        agents.push(this.eaterHunter);
    }
    if (jobType === 'infatuation' || (jobType === 'web_scrape' && (!config.sources || config.sources.includes('infatuation')))) {
        agents.push(this.infatuationHunter);
    }
    if (jobType === 'thrillist' || (jobType === 'web_scrape' && (!config.sources || config.sources.includes('thrillist')))) {
        agents.push(this.thrillistHunter);
    }

    // Initialize agents first (ensure DB records exist)
    for (const agent of agents) {
        await agent.initialize();
    }

    // Execute agents
    for (const agent of agents) {
        try {
            await agent.run();
            const metrics = agent.getMetrics();
            added += metrics.recordsCreated;
            failed += metrics.recordsFailed;
        } catch (error) {
            logger.error(`Agent failed`, error);
            failed++;
        }
    }

    return { added, failed };
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<ScrapingJobStatus | null> {
    const result = await pool.query(
      `SELECT * FROM scraping_jobs WHERE id = $1`,
      [jobId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const job = result.rows[0];
    return {
      id: job.id,
      jobType: job.job_type,
      cityId: job.city_id,
      category: job.category,
      status: job.status,
      venuesFound: job.venues_found || 0,
      venuesAdded: job.venues_added || 0,
      venuesUpdated: job.venues_updated || 0,
      venuesFailed: job.venues_failed || 0,
      errorMessage: job.error_message,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      createdAt: job.created_at
    };
  }

  /**
   * Get all jobs with optional filters
   */
  async getJobs(
    filters: {
      status?: string;
      jobType?: string;
      cityId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<ScrapingJobStatus[]> {
    let query = 'SELECT * FROM scraping_jobs WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;

    if (filters.status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(filters.status);
    }

    if (filters.jobType) {
      paramCount++;
      query += ` AND job_type = $${paramCount}`;
      params.push(filters.jobType);
    }

    if (filters.cityId) {
      paramCount++;
      query += ` AND city_id = $${paramCount}`;
      params.push(filters.cityId);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(filters.limit);
    }

    if (filters.offset) {
      paramCount++;
      query += ` OFFSET $${paramCount}`;
      params.push(filters.offset);
    }

    const result = await pool.query(query, params);

    return result.rows.map((job) => ({
      id: job.id,
      jobType: job.job_type,
      cityId: job.city_id,
      category: job.category,
      status: job.status,
      venuesFound: job.venues_found || 0,
      venuesAdded: job.venues_added || 0,
      venuesUpdated: job.venues_updated || 0,
      venuesFailed: job.venues_failed || 0,
      errorMessage: job.error_message,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      createdAt: job.created_at
    }));
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = await this.getJobStatus(jobId);
    if (!job) {
      return false;
    }

    if (job.status !== 'running' && job.status !== 'pending') {
      return false;
    }

    await pool.query(
      `UPDATE scraping_jobs 
       SET status = 'cancelled', completed_at = NOW() 
       WHERE id = $1`,
      [jobId]
    );

    logger.info(`Cancelled scraping job ${jobId}`);
    return true;
  }

  /**
   * Get active jobs count
   */
  async getActiveJobsCount(): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM scraping_jobs WHERE status = 'running'`
    );
    return parseInt(result.rows[0].count, 10);
  }
}
