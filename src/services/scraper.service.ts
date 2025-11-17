import pool from '../config/database';
import { VenueScraperService } from './venue-scraper.service';
import { EaterScraper, InfatuationScraper, ThrillistScraper } from './web-scraper.service';
import logger from './logger.service';
import { v4 as uuidv4 } from 'uuid';

export interface ScrapingJobConfig {
  cityId?: string;
  category?: string;
  sourceIds?: string[];
  maxVenues?: number;
}

export interface ScrapingJobResult {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  venuesFound: number;
  venuesAdded: number;
  venuesUpdated: number;
  venuesFailed: number;
  progressPercent: number;
  errorMessage?: string;
}

export class ScraperService {
  private static instance: ScraperService;
  private venueScraper: VenueScraperService;
  private eaterScraper: EaterScraper;
  private infatuationScraper: InfatuationScraper;
  private thrillistScraper: ThrillistScraper;
  private runningJobs: Map<string, Promise<void>> = new Map();

  private constructor() {
    this.venueScraper = VenueScraperService.getInstance();
    this.eaterScraper = new EaterScraper();
    this.infatuationScraper = new InfatuationScraper();
    this.thrillistScraper = new ThrillistScraper();
  }

  static getInstance(): ScraperService {
    if (!ScraperService.instance) {
      ScraperService.instance = new ScraperService();
    }
    return ScraperService.instance;
  }

  /**
   * Start a new scraping job
   */
  async startScrapingJob(
    jobType: 'api_scrape' | 'web_scrape' | 'csv_import' | 'manual_curation',
    sourceId: string | null,
    config: ScrapingJobConfig
  ): Promise<string> {
    const jobId = uuidv4();

    try {
      // Create job record
      await pool.query(
        `INSERT INTO scraping_jobs (
          id, job_type, source_id, city_id, category, status, config, started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          jobId,
          jobType,
          sourceId,
          config.cityId || null,
          config.category || null,
          'pending',
          JSON.stringify(config)
        ]
      );

      // Start job asynchronously
      const jobPromise = this.executeScrapingJob(jobId, jobType, sourceId, config);
      this.runningJobs.set(jobId, jobPromise);

      // Clean up when done
      jobPromise.finally(() => {
        this.runningJobs.delete(jobId);
      });

      logger.info(`Started scraping job ${jobId}`, { jobType, sourceId, config });
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
    _sourceId: string | null,
    config: ScrapingJobConfig
  ): Promise<void> {
    try {
      // Update status to running
      await pool.query(
        'UPDATE scraping_jobs SET status = $1, started_at = NOW() WHERE id = $2',
        ['running', jobId]
      );

      let venuesFound = 0;
      let venuesAdded = 0;
      let venuesUpdated = 0;
      let venuesFailed = 0;

      if (jobType === 'api_scrape') {
        // Use existing VenueScraperService for API scraping
        if (config.cityId) {
          const added = await this.venueScraper.scrapeVenues(config.cityId, config.category);
          venuesAdded = added;
          venuesFound = added; // VenueScraperService doesn't return found count, estimate
        } else {
          // Scrape all cities
          const cities = await pool.query('SELECT id FROM cities');
          for (const city of cities.rows) {
            const added = await this.venueScraper.scrapeVenues(city.id, config.category);
            venuesAdded += added;
            venuesFound += added;

            // Update progress
            const progress = Math.round((cities.rows.indexOf(city) + 1) / cities.rows.length * 100);
            await this.updateJobProgress(jobId, progress, venuesFound, venuesAdded, venuesUpdated, venuesFailed);
          }
        }
      } else if (jobType === 'web_scrape') {
        // Web scraping using specific scrapers
        const citySlugMap: { [key: string]: string } = {
          'nyc': 'nyc',
          'los-angeles': 'la',
          'chicago': 'chicago',
          'miami': 'miami',
          'las-vegas': 'vegas'
        };

        if (config.cityId) {
          const citySlug = citySlugMap[config.cityId] || config.cityId;
          
          // Scrape from all sources
          const sources = [
            { name: 'Eater', scraper: this.eaterScraper },
            { name: 'Infatuation', scraper: this.infatuationScraper },
            { name: 'Thrillist', scraper: this.thrillistScraper }
          ];

          for (const source of sources) {
            try {
              const result = await source.scraper.scrapeCityList(citySlug, config.cityId);
              venuesFound += result.found;
              venuesAdded += result.saved;
              
              // Update progress
              await this.updateJobProgress(
                jobId,
                50, // Mid-progress
                venuesFound,
                venuesAdded,
                venuesUpdated,
                venuesFailed
              );

              // Rate limiting between sources
              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
              logger.error(`Failed to scrape ${source.name} for ${citySlug}`, error);
              venuesFailed += 10; // Estimate
            }
          }
        } else {
          // Scrape all cities
          const cities = await pool.query('SELECT id FROM cities');
          for (const city of cities.rows) {
            const citySlug = citySlugMap[city.id] || city.id;
            
            const sources = [
              { name: 'Eater', scraper: this.eaterScraper },
              { name: 'Infatuation', scraper: this.infatuationScraper },
              { name: 'Thrillist', scraper: this.thrillistScraper }
            ];

            for (const source of sources) {
              try {
                const result = await source.scraper.scrapeCityList(citySlug, city.id);
                venuesFound += result.found;
                venuesAdded += result.saved;
              } catch (error) {
                logger.error(`Failed to scrape ${source.name} for ${citySlug}`, error);
                venuesFailed += 10;
              }
              
              await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Update progress
            const progress = Math.round((cities.rows.indexOf(city) + 1) / cities.rows.length * 100);
            await this.updateJobProgress(jobId, progress, venuesFound, venuesAdded, venuesUpdated, venuesFailed);
          }
        }
      }

      // Mark job as completed
      await pool.query(
        `UPDATE scraping_jobs 
         SET status = $1, completed_at = NOW(), progress_percent = 100,
             venues_found = $2, venues_added = $3, venues_updated = $4, venues_failed = $5
         WHERE id = $6`,
        ['completed', venuesFound, venuesAdded, venuesUpdated, venuesFailed, jobId]
      );

      logger.info(`Completed scraping job ${jobId}`, {
        venuesFound,
        venuesAdded,
        venuesUpdated,
        venuesFailed
      });
    } catch (error: any) {
      logger.error(`Scraping job ${jobId} failed`, error);

      // Update job with error
      await pool.query(
        `UPDATE scraping_jobs 
         SET status = $1, completed_at = NOW(), 
             error_message = $2, error_stack = $3
         WHERE id = $4`,
        ['failed', error.message, error.stack, jobId]
      );
    }
  }

  /**
   * Update job progress
   */
  private async updateJobProgress(
    jobId: string,
    progressPercent: number,
    venuesFound: number,
    venuesAdded: number,
    venuesUpdated: number,
    venuesFailed: number
  ): Promise<void> {
    await pool.query(
      `UPDATE scraping_jobs 
       SET progress_percent = $1, venues_found = $2, venues_added = $3, 
           venues_updated = $4, venues_failed = $5, updated_at = NOW()
       WHERE id = $6`,
      [progressPercent, venuesFound, venuesAdded, venuesUpdated, venuesFailed, jobId]
    );
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<ScrapingJobResult | null> {
    const result = await pool.query(
      'SELECT * FROM scraping_jobs WHERE id = $1',
      [jobId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const job = result.rows[0];
    return {
      jobId: job.id,
      status: job.status,
      venuesFound: job.venues_found || 0,
      venuesAdded: job.venues_added || 0,
      venuesUpdated: job.venues_updated || 0,
      venuesFailed: job.venues_failed || 0,
      progressPercent: job.progress_percent || 0,
      errorMessage: job.error_message
    };
  }

  /**
   * List all scraping jobs
   */
  async listJobs(
    filters?: {
      status?: string;
      jobType?: string;
      sourceId?: string;
      cityId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ jobs: any[]; total: number }> {
    let query = 'SELECT * FROM scraping_jobs WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;

    if (filters?.status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(filters.status);
    }

    if (filters?.jobType) {
      paramCount++;
      query += ` AND job_type = $${paramCount}`;
      params.push(filters.jobType);
    }

    if (filters?.sourceId) {
      paramCount++;
      query += ` AND source_id = $${paramCount}`;
      params.push(filters.sourceId);
    }

    if (filters?.cityId) {
      paramCount++;
      query += ` AND city_id = $${paramCount}`;
      params.push(filters.cityId);
    }

    query += ' ORDER BY created_at DESC';

    if (filters?.limit) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(filters.limit);
    }

    if (filters?.offset) {
      paramCount++;
      query += ` OFFSET $${paramCount}`;
      params.push(filters.offset);
    }

    const result = await pool.query(query, params);

    // Get total count
    const countQuery = query.replace(/SELECT \*/, 'SELECT COUNT(*)').split('ORDER BY')[0];
    const countResult = await pool.query(countQuery, params.slice(0, -2)); // Remove limit/offset params

    return {
      jobs: result.rows,
      total: parseInt(countResult.rows[0].count)
    };
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
      'UPDATE scraping_jobs SET status = $1, completed_at = NOW() WHERE id = $2',
      ['cancelled', jobId]
    );

    logger.info(`Cancelled scraping job ${jobId}`);
    return true;
  }
}

