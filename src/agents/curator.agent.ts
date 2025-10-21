import { Pool } from 'pg';
import { BaseAgent, AgentConfig, AgentRunMetrics } from './base.agent';
import logger from '../services/logger.service';

export interface CurationAlgorithm {
  id: string;
  name: string;
  version: string;
  expertWeight: number;
  consumerWeight: number;
  recencyWeight: number;
  sourceWeights: Record<string, number>;
  minSourceCount: number;
  minConfidenceScore: number;
  boostFactors: Record<string, number>;
}

export interface ScoredVenue {
  silverVenueId: string;
  name: string;
  finalScore: number;
  expertScore: number;
  consumerScore: number;
  recencyScore: number;
  boostScore: number;
  sourceMentions: number;
  topSources: string[];
  scoreBreakdown: Record<string, any>;
}

/**
 * Curator Agent - Creates ranked lists from silver layer data
 * 
 * Responsibilities:
 * - Apply weighted algorithms to score venues
 * - Generate city and category-specific lists
 * - Rank venues by calculated scores
 * - Populate Gold layer tables
 * - Track algorithm performance
 */
export abstract class CuratorAgent extends BaseAgent {
  protected algorithm: CurationAlgorithm;
  protected metrics: AgentRunMetrics;

  constructor(name: string, algorithm: CurationAlgorithm, config: AgentConfig, db: Pool) {
    super(name, 'curator', config, db);
    this.algorithm = algorithm;
    
    this.metrics = {
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0
    };
  }

  /**
   * Initialize algorithm in database
   */
  async initialize(): Promise<void> {
    await super.initialize();
    
    await this.db.query(
      `INSERT INTO curation_algorithms (
        id, name, version, expert_weight, consumer_weight,
        recency_weight, source_weights, min_source_count,
        min_confidence_score, boost_factors, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
      ON CONFLICT (id) DO UPDATE SET
        expert_weight = $4,
        consumer_weight = $5,
        recency_weight = $6,
        source_weights = $7,
        boost_factors = $10,
        updated_at = NOW()`,
      [
        this.algorithm.id,
        this.algorithm.name,
        this.algorithm.version,
        this.algorithm.expertWeight,
        this.algorithm.consumerWeight,
        this.algorithm.recencyWeight,
        this.algorithm.sourceWeights,
        this.algorithm.minSourceCount,
        this.algorithm.minConfidenceScore,
        this.algorithm.boostFactors
      ]
    );
  }

  /**
   * Calculate final score for a venue
   */
  protected calculateFinalScore(venue: any): ScoredVenue {
    const expertScore = venue.expert_score || 0;
    const consumerScore = venue.consumer_score || 0;
    const recencyScore = this.calculateRecencyScore(venue);
    const boostScore = this.calculateBoostScore(venue);

    const baseScore = (
      this.algorithm.expertWeight * expertScore +
      this.algorithm.consumerWeight * consumerScore +
      this.algorithm.recencyWeight * recencyScore
    );

    const finalScore = Math.min(baseScore + boostScore, 100);

    return {
      silverVenueId: venue.id,
      name: venue.canonical_name,
      finalScore,
      expertScore,
      consumerScore,
      recencyScore,
      boostScore,
      sourceMentions: venue.source_count || 0,
      topSources: venue.top_sources || [],
      scoreBreakdown: {
        base: baseScore,
        expert: expertScore,
        consumer: consumerScore,
        recency: recencyScore,
        boost: boostScore,
        weights: {
          expert: this.algorithm.expertWeight,
          consumer: this.algorithm.consumerWeight,
          recency: this.algorithm.recencyWeight
        }
      }
    };
  }

  /**
   * Calculate recency score based on when venue was last mentioned
   */
  protected calculateRecencyScore(venue: any): number {
    const lastVerified = venue.last_verified_at || venue.last_updated_at;
    if (!lastVerified) return 0;

    const daysSinceVerified = (Date.now() - new Date(lastVerified).getTime()) / (1000 * 60 * 60 * 24);
    const monthsSinceVerified = daysSinceVerified / 30;

    // Decay factor: 100 at 0 months, 50 at 12 months, 0 at 24+ months
    if (monthsSinceVerified <= 12) {
      return 100 - (monthsSinceVerified * (50 / 12));
    } else if (monthsSinceVerified <= 24) {
      return 50 - ((monthsSinceVerified - 12) * (50 / 12));
    } else {
      return 0;
    }
  }

  /**
   * Calculate boost score based on special attributes
   */
  protected calculateBoostScore(venue: any): number {
    let boostScore = 0;
    const tags = venue.tags || [];
    const features = venue.features || [];

    // Apply boost factors from algorithm config
    for (const [key, value] of Object.entries(this.algorithm.boostFactors)) {
      if (tags.includes(key) || features.includes(key)) {
        boostScore += value;
      }
    }

    return boostScore;
  }

  /**
   * Create or update a gold list
   */
  protected async createGoldList(
    name: string,
    cityId: string,
    category: string,
    description: string,
    scoredVenues: ScoredVenue[],
    targetVenueCount: number = 20
  ): Promise<string> {
    // Create or update gold list
    const listResult = await this.db.query(
      `INSERT INTO gold_lists (
        external_id, name, description, city_id, category,
        algorithm_id, curator_agent_id, target_venue_count,
        actual_venue_count, status, last_curated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', NOW()
      )
      ON CONFLICT (external_id) DO UPDATE SET
        name = $2,
        description = $3,
        algorithm_id = $6,
        actual_venue_count = $9,
        last_curated_at = NOW(),
        updated_at = NOW()
      RETURNING id`,
      [
        `${cityId}-${category.toLowerCase().replace(/\s+/g, '-')}`,
        name,
        description,
        cityId,
        category,
        this.algorithm.id,
        this.id,
        targetVenueCount,
        Math.min(scoredVenues.length, targetVenueCount)
      ]
    );

    const goldListId = listResult.rows[0].id;

    // Delete existing list items
    await this.db.query(
      `DELETE FROM gold_list_items WHERE gold_list_id = $1`,
      [goldListId]
    );

    // Insert new list items
    const topVenues = scoredVenues.slice(0, targetVenueCount);
    for (let i = 0; i < topVenues.length; i++) {
      const venue = topVenues[i];
      await this.db.query(
        `INSERT INTO gold_list_items (
          gold_list_id, silver_venue_id, position,
          final_score, expert_score, consumer_score,
          recency_score, boost_score, score_breakdown,
          included_reason, source_mentions, top_sources
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          goldListId,
          venue.silverVenueId,
          i + 1,
          venue.finalScore,
          venue.expertScore,
          venue.consumerScore,
          venue.recencyScore,
          venue.boostScore,
          venue.scoreBreakdown,
          `Ranked #${i + 1} based on weighted algorithm`,
          venue.sourceMentions,
          venue.topSources
        ]
      );
    }

    this.metrics.recordsCreated++;
    logger.info(`Created gold list: ${name} with ${topVenues.length} venues`);

    return goldListId;
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
 * City List Curator - Generates lists for a specific city
 */
export class CityListCurator extends CuratorAgent {
  private cityId: string;
  private categories: string[];

  constructor(
    db: Pool,
    cityId: string,
    categories: string[],
    algorithm: CurationAlgorithm
  ) {
    super(`CityListCurator-${cityId}`, algorithm, { cityId, categories }, db);
    this.cityId = cityId;
    this.categories = categories;
  }

  async execute(): Promise<void> {
    logger.info(`Curating lists for city: ${this.cityId}`);

    for (const category of this.categories) {
      try {
        await this.curateListForCategory(category);
        this.metrics.recordsProcessed++;
      } catch (error) {
        logger.error(`Failed to curate list for ${category}`, error);
        this.metrics.recordsFailed++;
      }
    }

    logger.info(`Curation complete for ${this.cityId}: ${this.metrics.recordsProcessed} lists created`);
  }

  private async curateListForCategory(category: string): Promise<void> {
    // Get all silver venues for this city and category
    const result = await this.db.query(
      `SELECT 
         sv.id,
         sv.canonical_name,
         sv.expert_score,
         sv.consumer_score,
         sv.source_count,
         sv.last_verified_at,
         sv.last_updated_at,
         sv.tags,
         sv.features,
         ARRAY_AGG(DISTINCT ds.id) as top_sources
       FROM silver_venues sv
       JOIN venue_source_mapping vsm ON sv.id = vsm.silver_venue_id
       JOIN bronze_venues bv ON vsm.bronze_venue_id = bv.id
       JOIN data_sources ds ON bv.source_id = ds.id
       WHERE sv.city_id = $1
         AND sv.primary_category = $2
         AND sv.is_active = true
         AND sv.confidence_score >= $3
       GROUP BY sv.id
       HAVING COUNT(DISTINCT bv.source_id) >= $4`,
      [
        this.cityId,
        category,
        this.algorithm.minConfidenceScore,
        this.algorithm.minSourceCount
      ]
    );

    // Score and rank venues
    const scoredVenues = result.rows
      .map(venue => this.calculateFinalScore(venue))
      .sort((a, b) => b.finalScore - a.finalScore);

    if (scoredVenues.length === 0) {
      logger.warn(`No venues found for ${this.cityId} - ${category}`);
      return;
    }

    // Create gold list
    await this.createGoldList(
      `Best ${category} in ${this.cityId.toUpperCase()}`,
      this.cityId,
      category,
      `Curated list of the best ${category.toLowerCase()} venues in ${this.cityId.toUpperCase()}, based on expert reviews and consumer ratings.`,
      scoredVenues,
      20
    );
  }
}

/**
 * Custom List Curator - Generates lists based on custom criteria
 */
export class CustomListCurator extends CuratorAgent {
  private listDefinition: {
    name: string;
    cityId: string;
    category: string;
    description: string;
    filters: Record<string, any>;
    targetCount: number;
  };

  constructor(
    db: Pool,
    listDefinition: any,
    algorithm: CurationAlgorithm
  ) {
    super(`CustomListCurator-${listDefinition.name}`, algorithm, { listDefinition }, db);
    this.listDefinition = listDefinition;
  }

  async execute(): Promise<void> {
    logger.info(`Curating custom list: ${this.listDefinition.name}`);

    // Build dynamic query based on filters
    let query = `
      SELECT 
        sv.id,
        sv.canonical_name,
        sv.expert_score,
        sv.consumer_score,
        sv.source_count,
        sv.last_verified_at,
        sv.last_updated_at,
        sv.tags,
        sv.features,
        ARRAY_AGG(DISTINCT ds.id) as top_sources
      FROM silver_venues sv
      JOIN venue_source_mapping vsm ON sv.id = vsm.silver_venue_id
      JOIN bronze_venues bv ON vsm.bronze_venue_id = bv.id
      JOIN data_sources ds ON bv.source_id = ds.id
      WHERE sv.city_id = $1
        AND sv.is_active = true
    `;

    const params: any[] = [this.listDefinition.cityId];
    let paramIndex = 2;

    // Apply filters
    if (this.listDefinition.filters.category) {
      query += ` AND sv.primary_category = $${paramIndex}`;
      params.push(this.listDefinition.filters.category);
      paramIndex++;
    }

    if (this.listDefinition.filters.cuisine) {
      query += ` AND sv.primary_cuisine = $${paramIndex}`;
      params.push(this.listDefinition.filters.cuisine);
      paramIndex++;
    }

    if (this.listDefinition.filters.priceLevel) {
      query += ` AND sv.price_level = $${paramIndex}`;
      params.push(this.listDefinition.filters.priceLevel);
      paramIndex++;
    }

    if (this.listDefinition.filters.tags && this.listDefinition.filters.tags.length > 0) {
      query += ` AND sv.tags && $${paramIndex}`;
      params.push(this.listDefinition.filters.tags);
      paramIndex++;
    }

    query += ` GROUP BY sv.id`;

    const result = await this.db.query(query, params);

    // Score and rank venues
    const scoredVenues = result.rows
      .map(venue => this.calculateFinalScore(venue))
      .sort((a, b) => b.finalScore - a.finalScore);

    if (scoredVenues.length === 0) {
      logger.warn(`No venues found for custom list: ${this.listDefinition.name}`);
      return;
    }

    // Create gold list
    await this.createGoldList(
      this.listDefinition.name,
      this.listDefinition.cityId,
      this.listDefinition.category,
      this.listDefinition.description,
      scoredVenues,
      this.listDefinition.targetCount
    );

    this.metrics.recordsCreated++;
  }
}

