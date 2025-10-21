import { Pool } from 'pg';
import { BaseAgent, AgentConfig, AgentRunMetrics } from './base.agent';
import logger from '../services/logger.service';

/**
 * Archivist Agent - Cleans, deduplicates, and organizes data
 * 
 * Responsibilities:
 * - Process Bronze layer data
 * - Deduplicate venues across sources
 * - Normalize and clean data
 * - Calculate scores and metrics
 * - Populate Silver layer tables
 */
export abstract class ArchivistAgent extends BaseAgent {
  protected metrics: AgentRunMetrics;

  constructor(name: string, config: AgentConfig, db: Pool) {
    super(name, 'archivist', config, db);
    
    this.metrics = {
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0
    };
  }

  /**
   * Calculate similarity between two strings (Levenshtein distance)
   */
  protected calculateStringSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    if (s1 === s2) return 1.0;
    
    const len1 = s1.length;
    const len2 = s2.length;
    
    if (len1 === 0 || len2 === 0) return 0;
    
    const matrix: number[][] = [];
    
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    
    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    return 1 - (distance / maxLen);
  }

  /**
   * Calculate distance between two coordinates in meters
   */
  protected calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371e3; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Normalize venue name
   */
  protected normalizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\b(restaurant|bar|cafe|coffee|the|a|an)\b/g, '')
      .trim();
  }

  /**
   * Run with metrics tracking
   */
  async run(): Promise<void> {
    this.metrics = {
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0
    };

    try {
      await this.startRun();
      await this.execute();
      await this.completeRun(this.metrics);
    } catch (error) {
      await this.completeRun(this.metrics, error as Error);
      throw error;
    }
  }

  abstract execute(): Promise<void>;
}

/**
 * Deduplication Archivist - Finds and merges duplicate venues
 */
export class DeduplicationAgent extends ArchivistAgent {
  private readonly SIMILARITY_THRESHOLD = 0.85;
  private readonly DISTANCE_THRESHOLD = 50; // meters

  constructor(db: Pool) {
    super('DeduplicationAgent', {}, db);
  }

  async execute(): Promise<void> {
    logger.info('Starting deduplication process');

    // Find pending bronze venues
    const bronzeVenues = await this.db.query(
      `SELECT id, name, address, city, latitude, longitude
       FROM bronze_venues
       WHERE processing_status = 'pending'
         AND latitude IS NOT NULL
         AND longitude IS NOT NULL
       LIMIT 1000`
    );

    for (const venue of bronzeVenues.rows) {
      try {
        await this.processVenue(venue);
        this.metrics.recordsProcessed++;
      } catch (error) {
        logger.error(`Failed to process venue ${venue.id}`, error);
        this.metrics.recordsFailed++;
      }
    }

    logger.info(`Deduplication complete: ${this.metrics.recordsProcessed} processed`);
  }

  private async processVenue(bronzeVenue: any): Promise<void> {
    // Find potential duplicates in silver layer
    const potentialDuplicates = await this.db.query(
      `SELECT id, canonical_name, normalized_address, 
              (coordinates->>'lat')::decimal as latitude,
              (coordinates->>'lng')::decimal as longitude
       FROM silver_venues
       WHERE city_id = $1
         AND is_active = true`,
      [bronzeVenue.city]
    );

    let bestMatch: any = null;
    let bestScore = 0;

    for (const silverVenue of potentialDuplicates.rows) {
      const score = this.calculateVenueSimilarity(bronzeVenue, silverVenue);
      
      if (score > this.SIMILARITY_THRESHOLD && score > bestScore) {
        bestScore = score;
        bestMatch = silverVenue;
      }
    }

    if (bestMatch) {
      // Map to existing silver venue
      await this.mapToSilverVenue(bronzeVenue.id, bestMatch.id, bestScore);
      this.metrics.recordsUpdated++;
    } else {
      // Create new silver venue
      const silverVenueId = await this.createSilverVenue(bronzeVenue);
      await this.mapToSilverVenue(bronzeVenue.id, silverVenueId, 1.0);
      this.metrics.recordsCreated++;
    }

    // Mark bronze venue as processed
    await this.db.query(
      `UPDATE bronze_venues SET processing_status = 'processed', processed_at = NOW()
       WHERE id = $1`,
      [bronzeVenue.id]
    );
  }

  private calculateVenueSimilarity(venue1: any, venue2: any): number {
    const nameSim = this.calculateStringSimilarity(
      this.normalizeName(venue1.name),
      this.normalizeName(venue2.canonical_name || venue2.name)
    );

    const addressSim = venue1.address && venue2.normalized_address
      ? this.calculateStringSimilarity(venue1.address, venue2.normalized_address)
      : 0;

    const distance = this.calculateDistance(
      venue1.latitude,
      venue1.longitude,
      venue2.latitude,
      venue2.longitude
    );

    const locationScore = distance < this.DISTANCE_THRESHOLD
      ? 1 - (distance / this.DISTANCE_THRESHOLD)
      : 0;

    // Weighted similarity score
    return (
      0.4 * nameSim +
      0.3 * addressSim +
      0.3 * locationScore
    );
  }

  private async createSilverVenue(bronzeVenue: any): Promise<string> {
    const result = await this.db.query(
      `INSERT INTO silver_venues (
        canonical_name, normalized_address, city_id,
        coordinates, primary_category, primary_cuisine,
        aggregated_rating, confidence_score,
        is_verified, is_active, source_count,
        first_seen_at, last_updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, false, true, 1, NOW(), NOW()
      ) RETURNING id`,
      [
        this.normalizeName(bronzeVenue.name),
        bronzeVenue.address,
        bronzeVenue.city,
        JSON.stringify({ lat: bronzeVenue.latitude, lng: bronzeVenue.longitude }),
        bronzeVenue.category,
        bronzeVenue.cuisine,
        bronzeVenue.rating,
        0.70 // Initial confidence
      ]
    );

    return result.rows[0].id;
  }

  private async mapToSilverVenue(
    bronzeVenueId: string,
    silverVenueId: string,
    confidenceScore: number
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO venue_source_mapping (
        silver_venue_id, bronze_venue_id, confidence_score, matched_at
      ) VALUES ($1, $2, $3, NOW())
      ON CONFLICT (silver_venue_id, bronze_venue_id) DO NOTHING`,
      [silverVenueId, bronzeVenueId, confidenceScore]
    );

    // Update source count
    await this.db.query(
      `UPDATE silver_venues 
       SET source_count = (
         SELECT COUNT(DISTINCT bronze_venue_id)
         FROM venue_source_mapping
         WHERE silver_venue_id = $1
       ),
       last_updated_at = NOW()
       WHERE id = $1`,
      [silverVenueId]
    );
  }
}

/**
 * Scoring Archivist - Calculates expert and consumer scores
 */
export class ScoringAgent extends ArchivistAgent {
  constructor(db: Pool) {
    super('ScoringAgent', {}, db);
  }

  async execute(): Promise<void> {
    logger.info('Starting scoring process');

    const silverVenues = await this.db.query(
      `SELECT sv.id, sv.city_id
       FROM silver_venues sv
       WHERE sv.is_active = true
         AND (sv.last_updated_at IS NULL OR sv.last_updated_at < NOW() - INTERVAL '1 day')
       LIMIT 1000`
    );

    for (const venue of silverVenues.rows) {
      try {
        await this.scoreVenue(venue.id);
        this.metrics.recordsProcessed++;
      } catch (error) {
        logger.error(`Failed to score venue ${venue.id}`, error);
        this.metrics.recordsFailed++;
      }
    }

    logger.info(`Scoring complete: ${this.metrics.recordsProcessed} venues scored`);
  }

  private async scoreVenue(silverVenueId: string): Promise<void> {
    // Calculate expert score from expert sources
    const expertScore = await this.calculateExpertScore(silverVenueId);
    
    // Calculate consumer score from consumer reviews
    const consumerScore = await this.calculateConsumerScore(silverVenueId);

    // Update silver venue with scores
    await this.db.query(
      `UPDATE silver_venues 
       SET expert_score = $1,
           consumer_score = $2,
           aggregated_rating = ($1 * 0.7 + $2 * 0.3),
           last_updated_at = NOW()
       WHERE id = $3`,
      [expertScore, consumerScore, silverVenueId]
    );

    this.metrics.recordsUpdated++;
  }

  private async calculateExpertScore(silverVenueId: string): Promise<number> {
    const result = await this.db.query(
      `SELECT 
         ds.authority_weight,
         COUNT(*) as mention_count,
         AVG(CASE WHEN svm.list_position IS NOT NULL 
             THEN (1.0 / svm.list_position) 
             ELSE 0.5 
         END) as position_score
       FROM venue_source_mapping vsm
       JOIN bronze_venues bv ON vsm.bronze_venue_id = bv.id
       JOIN data_sources ds ON bv.source_id = ds.id
       LEFT JOIN silver_venue_mentions svm ON svm.silver_venue_id = vsm.silver_venue_id
       WHERE vsm.silver_venue_id = $1
         AND ds.type = 'expert_list'
       GROUP BY ds.authority_weight`,
      [silverVenueId]
    );

    if (result.rows.length === 0) return 0;

    let totalScore = 0;
    let totalWeight = 0;

    for (const row of result.rows) {
      const score = row.authority_weight * row.mention_count * row.position_score;
      totalScore += score;
      totalWeight += row.authority_weight;
    }

    // Normalize to 0-100 scale
    return totalWeight > 0 ? Math.min((totalScore / totalWeight) * 100, 100) : 0;
  }

  private async calculateConsumerScore(silverVenueId: string): Promise<number> {
    const result = await this.db.query(
      `SELECT 
         ds.authority_weight,
         AVG(bv.rating) as avg_rating,
         COUNT(*) as review_count
       FROM venue_source_mapping vsm
       JOIN bronze_venues bv ON vsm.bronze_venue_id = bv.id
       JOIN data_sources ds ON bv.source_id = ds.id
       WHERE vsm.silver_venue_id = $1
         AND ds.type = 'consumer_review'
         AND bv.rating IS NOT NULL
       GROUP BY ds.authority_weight`,
      [silverVenueId]
    );

    if (result.rows.length === 0) return 0;

    let totalScore = 0;
    let totalWeight = 0;

    for (const row of result.rows) {
      // Normalize rating to 0-100 scale (assuming 0-5 star scale)
      const normalizedRating = (parseFloat(row.avg_rating) / 5.0) * 100;
      const score = row.authority_weight * normalizedRating;
      totalScore += score;
      totalWeight += row.authority_weight;
    }

    return totalWeight > 0 ? (totalScore / totalWeight) : 0;
  }
}

