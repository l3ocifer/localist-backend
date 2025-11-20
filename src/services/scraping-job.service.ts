import pool from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger.service';

export interface ScrapingJobConfig {
  sourceId?: string;
  cityId?: string;
  category?: string;
  config?: Record<string, any>;
}

export interface ScrapingJobMetrics {
  recordsFound: number;
  recordsProcessed: number;
  recordsAdded: number;
  recordsUpdated: number;
  recordsFailed: number;
}

export class ScrapingJobService {
  private static instance: ScrapingJobService;

  private constructor() {}

  static getInstance(): ScrapingJobService {
    if (!ScrapingJobService.instance) {
      ScrapingJobService.instance = new ScrapingJobService();
    }
    return ScrapingJobService.instance;
  }

  /**
   * Create a new scraping job
   */
  async createJob(
    jobType: 'venue_scrape' | 'list_scrape' | 'review_scrape' | 'bulk_import',
    config: ScrapingJobConfig,
    createdBy?: string
  ): Promise<string> {
    try {
      const jobId = uuidv4();
      await pool.query(
        `INSERT INTO scraping_jobs (
          id, job_type, source_id, city_id, category, status, config, created_by
        ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
        [
          jobId,
          jobType,
          config.sourceId || null,
          config.cityId || null,
          config.category || null,
          JSON.stringify(config.config || {}),
          createdBy || null
        ]
      );

      logger.info(`Created scraping job ${jobId} of type ${jobType}`);
      return jobId;
    } catch (error) {
      logger.error('Failed to create scraping job', error);
      throw error;
    }
  }

  /**
   * Start a scraping job
   */
  async startJob(jobId: string): Promise<void> {
    await pool.query(
      `UPDATE scraping_jobs 
       SET status = 'running', started_at = NOW(), progress_percentage = 0
       WHERE id = $1`,
      [jobId]
    );
    logger.info(`Started scraping job ${jobId}`);
  }

  /**
   * Update job progress
   */
  async updateProgress(
    jobId: string,
    progress: number,
    metrics?: Partial<ScrapingJobMetrics>
  ): Promise<void> {
    const updates: string[] = ['progress_percentage = $2'];
    const values: any[] = [jobId, Math.max(0, Math.min(100, progress))];
    let paramIndex = 3;

    if (metrics) {
      if (metrics.recordsFound !== undefined) {
        updates.push(`records_found = $${paramIndex++}`);
        values.push(metrics.recordsFound);
      }
      if (metrics.recordsProcessed !== undefined) {
        updates.push(`records_processed = $${paramIndex++}`);
        values.push(metrics.recordsProcessed);
      }
      if (metrics.recordsAdded !== undefined) {
        updates.push(`records_added = $${paramIndex++}`);
        values.push(metrics.recordsAdded);
      }
      if (metrics.recordsUpdated !== undefined) {
        updates.push(`records_updated = $${paramIndex++}`);
        values.push(metrics.recordsUpdated);
      }
      if (metrics.recordsFailed !== undefined) {
        updates.push(`records_failed = $${paramIndex++}`);
        values.push(metrics.recordsFailed);
      }
    }

    await pool.query(
      `UPDATE scraping_jobs SET ${updates.join(', ')} WHERE id = $1`,
      values
    );
  }

  /**
   * Complete a scraping job
   */
  async completeJob(jobId: string, metrics?: ScrapingJobMetrics): Promise<void> {
    const updates: string[] = [
      "status = 'completed'",
      'completed_at = NOW()',
      'progress_percentage = 100'
    ];
    const values: any[] = [jobId];
    let paramIndex = 2;

    if (metrics) {
      updates.push(`records_found = $${paramIndex++}`);
      values.push(metrics.recordsFound);
      updates.push(`records_processed = $${paramIndex++}`);
      values.push(metrics.recordsProcessed);
      updates.push(`records_added = $${paramIndex++}`);
      values.push(metrics.recordsAdded);
      updates.push(`records_updated = $${paramIndex++}`);
      values.push(metrics.recordsUpdated);
      updates.push(`records_failed = $${paramIndex++}`);
      values.push(metrics.recordsFailed);
    }

    await pool.query(
      `UPDATE scraping_jobs SET ${updates.join(', ')} WHERE id = $1`,
      values
    );
    logger.info(`Completed scraping job ${jobId}`);
  }

  /**
   * Fail a scraping job
   */
  async failJob(jobId: string, errorMessage: string, errorDetails?: any): Promise<void> {
    await pool.query(
      `UPDATE scraping_jobs 
       SET status = 'failed', 
           completed_at = NOW(),
           error_message = $2,
           error_details = $3
       WHERE id = $1`,
      [jobId, errorMessage, JSON.stringify(errorDetails || {})]
    );
    logger.error(`Failed scraping job ${jobId}: ${errorMessage}`);
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<any> {
    const result = await pool.query('SELECT * FROM scraping_jobs WHERE id = $1', [jobId]);
    if (result.rows.length === 0) {
      throw new Error(`Job ${jobId} not found`);
    }
    return result.rows[0];
  }

  /**
   * Get all jobs with filters
   */
  async getJobs(filters?: {
    status?: string;
    jobType?: string;
    sourceId?: string;
    cityId?: string;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (filters?.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(filters.status);
    }
    if (filters?.jobType) {
      conditions.push(`job_type = $${paramIndex++}`);
      values.push(filters.jobType);
    }
    if (filters?.sourceId) {
      conditions.push(`source_id = $${paramIndex++}`);
      values.push(filters.sourceId);
    }
    if (filters?.cityId) {
      conditions.push(`city_id = $${paramIndex++}`);
      values.push(filters.cityId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = filters?.limit ? `LIMIT $${paramIndex++}` : 'LIMIT 50';
    const offsetClause = filters?.offset ? `OFFSET $${paramIndex++}` : '';

    if (filters?.limit) values.push(filters.limit);
    if (filters?.offset) values.push(filters.offset);

    const query = `
      SELECT * FROM scraping_jobs 
      ${whereClause}
      ORDER BY created_at DESC
      ${limitClause}
      ${offsetClause}
    `;

    const result = await pool.query(query, values);
    return result.rows;
  }

  /**
   * Add log entry for a job
   */
  async addLog(
    jobId: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    metadata?: any
  ): Promise<void> {
    await pool.query(
      `INSERT INTO scraping_job_logs (job_id, log_level, message, metadata)
       VALUES ($1, $2, $3, $4)`,
      [jobId, level, message, JSON.stringify(metadata || {})]
    );
  }

  /**
   * Get logs for a job
   */
  async getLogs(jobId: string, limit: number = 100): Promise<any[]> {
    const result = await pool.query(
      `SELECT * FROM scraping_job_logs 
       WHERE job_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [jobId, limit]
    );
    return result.rows;
  }
}



