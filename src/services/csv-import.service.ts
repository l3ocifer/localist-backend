import { parse } from 'csv-parse';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import logger from './logger.service';

export interface ImportBatch {
  id: string;
  filename: string;
  source: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  error_log: any[];
  created_by?: string;
  created_at: Date;
}

export class CsvImportService {
  private static instance: CsvImportService;

  private constructor() {}

  static getInstance(): CsvImportService {
    if (!CsvImportService.instance) {
      CsvImportService.instance = new CsvImportService();
    }
    return CsvImportService.instance;
  }

  /**
   * Create a new import batch record
   */
  async createBatch(filename: string, userId?: string): Promise<string> {
    const id = uuidv4();
    await pool.query(
      `INSERT INTO import_batches (id, batch_name, file_name, status, created_by)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [id, filename, filename, userId]
    );
    return id;
  }

  /**
   * Get batch status
   */
  async getBatchStatus(batchId: string): Promise<ImportBatch | null> {
    const result = await pool.query(
      `SELECT 
        id, batch_name as filename, 'csv' as source,
        status, total_rows, rows_processed as processed_rows, 
        rows_failed as failed_rows, error_summary as error_log,
        created_by, created_at
       FROM import_batches WHERE id = $1`,
      [batchId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  }

  /**
   * Process a CSV file
   */
  async processFile(batchId: string, filePath: string): Promise<void> {
    logger.info(`Starting CSV processing for batch ${batchId}`);
    
    try {
      // Update status to processing
      await pool.query(
        `UPDATE import_batches SET status = 'parsing' WHERE id = $1`,
        [batchId]
      );

      const results: any[] = [];
      const errors: any[] = [];
      let rowCount = 0;

      // Create parser
      const parser = fs.createReadStream(filePath).pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true
        })
      );

      for await (const record of parser) {
        rowCount++;
        try {
          await this.processRecord(record);
          results.push(record);
        } catch (error: any) {
          errors.push({ row: rowCount, error: error.message, data: record });
          logger.error(`Error processing row ${rowCount} in batch ${batchId}`, error);
        }
      }

      // Update batch status
      await pool.query(
        `UPDATE import_batches 
         SET status = $1, 
             total_rows = $2, 
             rows_processed = $3, 
             rows_failed = $4, 
             error_summary = $5 
         WHERE id = $6`,
        [
          errors.length === rowCount ? 'failed' : 'completed',
          rowCount,
          rowCount - errors.length,
          errors.length,
          JSON.stringify(errors),
          batchId
        ]
      );

      logger.info(`Completed CSV processing for batch ${batchId}`);

    } catch (error: any) {
      logger.error(`Fatal error processing batch ${batchId}`, error);
      await pool.query(
        `UPDATE import_batches 
         SET status = 'failed', 
             error_summary = $1 
         WHERE id = $2`,
        [JSON.stringify([{ error: error.message }]), batchId]
      );
    } finally {
        // Clean up file
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {
            logger.warn(`Failed to delete temp file ${filePath}`);
        }
    }
  }

  /**
   * Process a single record from the CSV
   * Maps CSV columns to venue fields and inserts/updates
   */
  private async processRecord(record: any): Promise<void> {
    // Validate required fields
    if (!record.name || !record.city_id) {
      throw new Error('Missing required fields: name, city_id');
    }

    // Basic validation
    const venue = {
        name: record.name,
        city_id: record.city_id,
        category: record.category || 'restaurant',
        cuisine: record.cuisine,
        price_range: record.price_range || '$$',
        description: record.description,
        address: record.address,
        phone: record.phone,
        website: record.website,
        image_url: record.image_url,
        rating: parseFloat(record.rating) || null,
        coordinates: record.lat && record.lng ? { lat: parseFloat(record.lat), lng: parseFloat(record.lng) } : null,
        features: record.features ? record.features.split(',').map((f: string) => f.trim()) : []
    };

    // Insert into content_review_queue for approval
    await pool.query(
        `INSERT INTO content_review_queue (
            content_type, content_id, source_id, status, content_preview
        ) VALUES ($1, $2, $3, $4, $5)`,
        ['venue', `csv-${record.name}`, 'csv_import', 'pending', JSON.stringify(venue)]
    );
  }
}
