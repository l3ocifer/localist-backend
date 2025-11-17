import csvParser from 'csv-parser';
import { Readable } from 'stream';
import pool from '../config/database';
import logger from './logger.service';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

export interface CSVImportConfig {
  mapping?: {
    name?: string;
    address?: string;
    city?: string;
    category?: string;
    cuisine?: string;
    phone?: string;
    website?: string;
    description?: string;
    price_range?: string;
    rating?: string;
    latitude?: string;
    longitude?: string;
  };
  cityId?: string;
  skipFirstRow?: boolean;
}

export interface CSVRow {
  [key: string]: string;
}

export class CSVImportService {
  /**
   * Process CSV file and create import batch
   */
  async createImportBatch(
    filename: string,
    fileBuffer: Buffer,
    config: CSVImportConfig
  ): Promise<string> {
    const batchId = uuidv4();
    const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

    try {
      // Create import batch record
      await pool.query(
        `INSERT INTO import_batches (
          id, filename, file_size_bytes, file_hash, status, mapping_config, import_config
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          batchId,
          filename,
          fileBuffer.length,
          fileHash,
          'pending',
          JSON.stringify(config.mapping || {}),
          JSON.stringify(config)
        ]
      );

      // Check for duplicate file
      const duplicateCheck = await pool.query(
        'SELECT id FROM import_batches WHERE file_hash = $1 AND id != $2',
        [fileHash, batchId]
      );

      if (duplicateCheck.rows.length > 0) {
        await pool.query(
          'UPDATE import_batches SET status = $1 WHERE id = $2',
          ['failed', batchId]
        );
        throw new Error('Duplicate file detected (same hash)');
      }

      // Process CSV asynchronously
      this.processCSV(batchId, fileBuffer, config).catch(error => {
        logger.error(`CSV import batch ${batchId} failed`, error);
      });

      return batchId;
    } catch (error) {
      logger.error('Failed to create import batch', error);
      throw error;
    }
  }

  /**
   * Process CSV file
   */
  private async processCSV(
    batchId: string,
    fileBuffer: Buffer,
    config: CSVImportConfig
  ): Promise<void> {
    try {
      // Update status to parsing
      await pool.query(
        'UPDATE import_batches SET status = $1, started_at = NOW() WHERE id = $2',
        ['parsing', batchId]
      );

      const rows: CSVRow[] = [];
      
      // Try to detect encoding - default to utf8
      let fileContent: string;
      try {
        // Try UTF-8 first
        fileContent = fileBuffer.toString('utf8');
      } catch {
        // Fallback to latin1 if UTF-8 fails
        fileContent = fileBuffer.toString('latin1');
      }
      
      const stream = Readable.from(fileContent);

      await new Promise<void>((resolve, reject) => {
        stream
          .pipe(csvParser())
          .on('data', (row: CSVRow) => {
            // Skip completely empty rows
            const hasData = Object.values(row).some(val => val && String(val).trim().length > 0);
            if (hasData) {
              rows.push(row);
            }
          })
          .on('end', () => {
            resolve();
          })
          .on('error', (error) => {
            reject(error);
          });
      });

      // Update status to validating
      await pool.query(
        `UPDATE import_batches SET status = $1, total_rows = $2 WHERE id = $3`,
        ['validating', rows.length, batchId]
      );

      // Validate and import rows
      const validationErrors: any[] = [];
      let rowsProcessed = 0;
      let rowsSuccessful = 0;
      let rowsFailed = 0;

      // Skip first row if configured
      const dataRows = config.skipFirstRow ? rows.slice(1) : rows;

      for (const row of dataRows) {
        rowsProcessed++;

        try {
          const venue = this.mapRowToVenue(row, config);
          const validationError = this.validateVenue(venue);

          if (validationError) {
            validationErrors.push({
              row: rowsProcessed,
              error: validationError,
              data: row
            });
            rowsFailed++;
          } else {
            await this.importVenue(venue, config.cityId);
            rowsSuccessful++;
          }

          // Update progress every 10 rows or at end
          if (rowsProcessed % 10 === 0 || rowsProcessed === dataRows.length) {
            const progress = dataRows.length > 0 
              ? Math.round((rowsProcessed / dataRows.length) * 100)
              : 0;
            await pool.query(
              `UPDATE import_batches 
               SET progress_percent = $1, rows_processed = $2, 
                   rows_successful = $3, rows_failed = $4,
                   validation_errors = $5
               WHERE id = $6`,
              [
                progress,
                rowsProcessed,
                rowsSuccessful,
                rowsFailed,
                JSON.stringify(validationErrors.slice(-100)), // Keep last 100 errors
                batchId
              ]
            );
          }
        } catch (error: any) {
          rowsFailed++;
          validationErrors.push({
            row: rowsProcessed,
            error: error.message,
            data: row
          });
        }
      }

      // Mark as completed
      await pool.query(
        `UPDATE import_batches 
         SET status = $1, completed_at = NOW(), progress_percent = 100,
             rows_processed = $2, rows_successful = $3, rows_failed = $4,
             validation_errors = $5
         WHERE id = $6`,
        [
          'completed',
          rowsProcessed,
          rowsSuccessful,
          rowsFailed,
          JSON.stringify(validationErrors),
          batchId
        ]
      );

      logger.info(`CSV import batch ${batchId} completed`, {
        rowsProcessed,
        rowsSuccessful,
        rowsFailed
      });
    } catch (error: any) {
      logger.error(`CSV import batch ${batchId} failed`, error);

      await pool.query(
        `UPDATE import_batches 
         SET status = $1, completed_at = NOW(), 
             error_summary = $2
         WHERE id = $3`,
        ['failed', JSON.stringify([{ error: error.message }]), batchId]
      );
    }
  }

  /**
   * Map CSV row to venue object
   */
  private mapRowToVenue(row: CSVRow, config: CSVImportConfig): any {
    const mapping = config.mapping || {};
    const venue: any = {};

    // Helper to safely get and trim field value
    const getField = (fieldName: string | undefined): string | undefined => {
      if (!fieldName || !row[fieldName]) return undefined;
      const value = String(row[fieldName]).trim();
      return value.length > 0 ? value : undefined;
    };

    // Map fields based on configuration
    if (mapping.name) venue.name = getField(mapping.name);
    if (mapping.address) venue.address = getField(mapping.address);
    if (mapping.city) venue.city = getField(mapping.city);
    if (mapping.category) venue.category = getField(mapping.category);
    if (mapping.cuisine) venue.cuisine = getField(mapping.cuisine);
    if (mapping.phone) venue.phone = getField(mapping.phone);
    if (mapping.website) venue.website = getField(mapping.website);
    if (mapping.description) venue.description = getField(mapping.description);
    if (mapping.price_range) {
      const priceRange = getField(mapping.price_range);
      // Normalize price range format
      if (priceRange) {
        const normalized = priceRange.replace(/[^$]/g, '');
        venue.price_range = normalized.length > 0 && normalized.length <= 4 ? normalized : '$$';
      }
    }
    
    // Parse numeric fields with validation
    if (mapping.rating) {
      const ratingStr = getField(mapping.rating);
      if (ratingStr) {
        const rating = parseFloat(ratingStr);
        venue.rating = isNaN(rating) ? null : Math.max(0, Math.min(5, rating));
      }
    }
    
    if (mapping.latitude) {
      const latStr = getField(mapping.latitude);
      if (latStr) {
        const lat = parseFloat(latStr);
        venue.latitude = isNaN(lat) ? null : Math.max(-90, Math.min(90, lat));
      }
    }
    
    if (mapping.longitude) {
      const lngStr = getField(mapping.longitude);
      if (lngStr) {
        const lng = parseFloat(lngStr);
        venue.longitude = isNaN(lng) ? null : Math.max(-180, Math.min(180, lng));
      }
    }

    return venue;
  }

  /**
   * Validate venue data
   */
  private validateVenue(venue: any): string | null {
    if (!venue.name || venue.name.trim().length === 0) {
      return 'Name is required';
    }

    if (venue.rating !== null && (venue.rating < 0 || venue.rating > 5)) {
      return 'Rating must be between 0 and 5';
    }

    if (venue.latitude !== null && (venue.latitude < -90 || venue.latitude > 90)) {
      return 'Latitude must be between -90 and 90';
    }

    if (venue.longitude !== null && (venue.longitude < -180 || venue.longitude > 180)) {
      return 'Longitude must be between -180 and 180';
    }

    return null;
  }

  /**
   * Import venue to database (check for duplicates by name/city)
   */
  private async importVenue(venue: any, cityId?: string): Promise<void> {
    const normalizedName = venue.name.trim();
    const targetCityId = cityId || venue.city;

    if (!targetCityId) {
      throw new Error('City ID is required for venue import');
    }

    // Build coordinates if available
    let coordinates = null;
    if (venue.latitude !== null && venue.longitude !== null) {
      coordinates = JSON.stringify({
        lat: venue.latitude,
        lng: venue.longitude
      });
    }

    // Check if venue already exists
    const existing = await pool.query(
      `SELECT id FROM venues 
       WHERE LOWER(TRIM(name)) = LOWER($1) AND city_id = $2 
       LIMIT 1`,
      [normalizedName, targetCityId]
    );

    if (existing.rows.length > 0) {
      // Update existing venue
      await pool.query(
        `UPDATE venues SET
          category = COALESCE($1, category),
          cuisine = COALESCE($2, cuisine),
          price_range = COALESCE($3, price_range),
          description = COALESCE(NULLIF($4, ''), description),
          address = COALESCE(NULLIF($5, ''), address),
          phone = COALESCE(NULLIF($6, ''), phone),
          website = COALESCE(NULLIF($7, ''), website),
          rating = COALESCE($8, rating),
          coordinates = COALESCE($9, coordinates),
          updated_at = NOW()
        WHERE id = $10`,
        [
          venue.category || null,
          venue.cuisine || null,
          venue.price_range || null,
          venue.description || null,
          venue.address || null,
          venue.phone || null,
          venue.website || null,
          venue.rating || null,
          coordinates,
          existing.rows[0].id
        ]
      );
    } else {
      // Insert new venue
      const venueId = uuidv4();
      await pool.query(
        `INSERT INTO venues (
          id, name, city_id, category, cuisine, price_range, description,
          address, phone, website, rating, coordinates
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          venueId,
          normalizedName,
          targetCityId,
          venue.category || 'restaurant',
          venue.cuisine || null,
          venue.price_range || '$$',
          venue.description || null,
          venue.address || null,
          venue.phone || null,
          venue.website || null,
          venue.rating || null,
          coordinates
        ]
      );
    }
  }

  /**
   * Get import batch status
   */
  async getBatchStatus(batchId: string): Promise<any> {
    const result = await pool.query(
      'SELECT * FROM import_batches WHERE id = $1',
      [batchId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  }

  /**
   * List import batches
   */
  async listBatches(filters?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ batches: any[]; total: number }> {
    let query = 'SELECT * FROM import_batches WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;

    if (filters?.status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(filters.status);
    }

    query += ' ORDER BY uploaded_at DESC';

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
    const countResult = await pool.query(countQuery, params.slice(0, -2));

    return {
      batches: result.rows,
      total: parseInt(countResult.rows[0].count)
    };
  }
}

