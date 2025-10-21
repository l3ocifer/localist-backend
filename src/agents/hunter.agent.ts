import { Pool } from 'pg';
import axios, { AxiosInstance } from 'axios';
import { BaseAgent, AgentConfig, AgentRunMetrics } from './base.agent';
import logger from '../services/logger.service';

export interface DataSource {
  id: string;
  name: string;
  type: 'expert_list' | 'consumer_review' | 'social' | 'search' | 'manual';
  authorityWeight: number;
  url?: string;
  scrapeConfig: Record<string, any>;
  isActive: boolean;
}

/**
 * Hunter Agent - Collects raw data from external sources
 * 
 * Responsibilities:
 * - Scrape/fetch data from configured sources
 * - Insert raw data into Bronze layer tables
 * - Handle rate limiting and retries
 * - Track ingestion metrics
 */
export abstract class HunterAgent extends BaseAgent {
  protected source: DataSource;
  protected httpClient: AxiosInstance;
  protected metrics: AgentRunMetrics;

  constructor(name: string, source: DataSource, config: AgentConfig, db: Pool) {
    super(name, 'hunter', config, db);
    this.source = source;
    
    // Initialize HTTP client with rate limiting
    this.httpClient = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': 'DiscoverLocal.ai/1.0 (Data Aggregation Bot)',
      }
    });

    this.metrics = {
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0
    };
  }

  /**
   * Initialize source in database if not exists
   */
  async initialize(): Promise<void> {
    await super.initialize();
    
    // Ensure data source exists
    await this.db.query(
      `INSERT INTO data_sources (id, name, type, authority_weight, url, scrape_config, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE 
       SET authority_weight = $4, scrape_config = $6, updated_at = NOW()`,
      [
        this.source.id,
        this.source.name,
        this.source.type,
        this.source.authorityWeight,
        this.source.url,
        this.source.scrapeConfig,
        this.source.isActive
      ]
    );
  }

  /**
   * Insert raw venue data into bronze layer
   */
  protected async insertBronzeVenue(venueData: any): Promise<string> {
    try {
      const result = await this.db.query(
        `INSERT INTO bronze_venues (
          source_id, source_venue_id, source_url, raw_data,
          name, address, city, state, postal_code, country,
          phone, website, cuisine, category, price_range,
          rating, review_count, latitude, longitude,
          processing_status, ingested_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, 'pending', NOW()
        )
        ON CONFLICT (source_id, source_venue_id) 
        DO UPDATE SET 
          raw_data = $4,
          name = $5,
          rating = $16,
          review_count = $17,
          ingested_at = NOW()
        RETURNING id`,
        [
          this.source.id,
          venueData.sourceVenueId,
          venueData.sourceUrl,
          venueData.rawData,
          venueData.name,
          venueData.address,
          venueData.city,
          venueData.state,
          venueData.postalCode,
          venueData.country,
          venueData.phone,
          venueData.website,
          venueData.cuisine,
          venueData.category,
          venueData.priceRange,
          venueData.rating,
          venueData.reviewCount,
          venueData.latitude,
          venueData.longitude
        ]
      );

      this.metrics.recordsCreated++;
      return result.rows[0].id;
    } catch (error) {
      this.metrics.recordsFailed++;
      logger.error(`Failed to insert bronze venue: ${venueData.name}`, error);
      throw error;
    }
  }

  /**
   * Insert raw list data into bronze layer
   */
  protected async insertBronzeList(listData: any): Promise<string> {
    try {
      const result = await this.db.query(
        `INSERT INTO bronze_lists (
          source_id, source_list_id, source_url, raw_data,
          name, description, city, category, curator,
          venue_count, published_date,
          processing_status, ingested_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', NOW()
        )
        ON CONFLICT (source_id, source_list_id)
        DO UPDATE SET
          raw_data = $4,
          name = $5,
          venue_count = $10,
          ingested_at = NOW()
        RETURNING id`,
        [
          this.source.id,
          listData.sourceListId,
          listData.sourceUrl,
          listData.rawData,
          listData.name,
          listData.description,
          listData.city,
          listData.category,
          listData.curator,
          listData.venueCount,
          listData.publishedDate
        ]
      );

      this.metrics.recordsCreated++;
      return result.rows[0].id;
    } catch (error) {
      this.metrics.recordsFailed++;
      logger.error(`Failed to insert bronze list: ${listData.name}`, error);
      throw error;
    }
  }

  /**
   * Insert raw review data into bronze layer
   */
  protected async insertBronzeReview(reviewData: any): Promise<string> {
    try {
      const result = await this.db.query(
        `INSERT INTO bronze_reviews (
          source_id, source_review_id, source_venue_id, source_url, raw_data,
          venue_name, rating, review_text, reviewer_name, review_date,
          helpful_count, processing_status, ingested_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', NOW()
        )
        ON CONFLICT (source_id, source_review_id)
        DO UPDATE SET
          raw_data = $5,
          rating = $7,
          helpful_count = $11,
          ingested_at = NOW()
        RETURNING id`,
        [
          this.source.id,
          reviewData.sourceReviewId,
          reviewData.sourceVenueId,
          reviewData.sourceUrl,
          reviewData.rawData,
          reviewData.venueName,
          reviewData.rating,
          reviewData.reviewText,
          reviewData.reviewerName,
          reviewData.reviewDate,
          reviewData.helpfulCount
        ]
      );

      this.metrics.recordsCreated++;
      return result.rows[0].id;
    } catch (error) {
      this.metrics.recordsFailed++;
      logger.error(`Failed to insert bronze review`, error);
      throw error;
    }
  }

  /**
   * Update last scraped timestamp for source
   */
  protected async updateLastScraped(): Promise<void> {
    await this.db.query(
      `UPDATE data_sources SET last_scraped_at = NOW() WHERE id = $1`,
      [this.source.id]
    );
  }

  /**
   * Rate limiting helper
   */
  protected async rateLimitDelay(delayMs: number = 1000): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  /**
   * Execute the hunter logic - must be implemented by specific hunter
   */
  abstract execute(): Promise<void>;

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
      await this.updateLastScraped();
      await this.completeRun(this.metrics);
    } catch (error) {
      await this.completeRun(this.metrics, error as Error);
      throw error;
    }
  }
}

/**
 * Example: Eater 38 Hunter
 */
export class EaterHunter extends HunterAgent {
  constructor(db: Pool) {
    const source: DataSource = {
      id: 'eater_38',
      name: 'Eater 38',
      type: 'expert_list',
      authorityWeight: 0.90,
      url: 'https://www.eater.com',
      scrapeConfig: {
        cities: ['nyc', 'la', 'chicago', 'miami', 'vegas'],
        urlPattern: 'https://www.eater.com/{city}/maps/'
      },
      isActive: true
    };

    super('EaterHunter', source, {}, db);
  }

  async execute(): Promise<void> {
    const cities = this.source.scrapeConfig.cities as string[];
    
    for (const city of cities) {
      logger.info(`Fetching Eater 38 for ${city}`);
      
      try {
        // TODO: Implement actual scraping logic
        // This is a placeholder showing the structure
        const venueList = await this.scrapeEaterCity(city);
        
        for (const venue of venueList) {
          await this.insertBronzeVenue(venue);
          this.metrics.recordsProcessed++;
        }
        
        // Rate limiting
        await this.rateLimitDelay(2000);
        
      } catch (error) {
        logger.error(`Failed to scrape Eater 38 for ${city}`, error);
        this.metrics.recordsFailed++;
      }
    }
  }

  private async scrapeEaterCity(_city: string): Promise<any[]> {
    // Placeholder - implement actual scraping
    // Could use Puppeteer, Cheerio, or API calls
    return [];
  }
}

/**
 * Example: Yelp Hunter
 */
export class YelpHunter extends HunterAgent {
  constructor(db: Pool, apiKey: string) {
    const source: DataSource = {
      id: 'yelp',
      name: 'Yelp',
      type: 'consumer_review',
      authorityWeight: 0.30,
      url: 'https://api.yelp.com/v3',
      scrapeConfig: {
        apiKey,
        rateLimit: '5000/day'
      },
      isActive: true
    };

    super('YelpHunter', source, { apiKey }, db);
    
    // Configure Yelp API client
    this.httpClient.defaults.headers.common['Authorization'] = `Bearer ${apiKey}`;
    this.httpClient.defaults.baseURL = 'https://api.yelp.com/v3';
  }

  async execute(): Promise<void> {
    // TODO: Implement Yelp API integration
    logger.info('Yelp Hunter execution - placeholder');
  }
}

