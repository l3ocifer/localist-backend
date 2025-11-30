import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import logger from './logger.service';
import { PerplexityAPIService } from './perplexity-api.service';
import { SearXNGService } from './searxng.service';
import { VenueScraperService } from './venue-scraper.service';

// UnifiedVenue interface for future use when returning enriched venue data
export interface UnifiedVenue {
  id?: string;
  name: string;
  address?: string;
  cityId: string;
  cityName: string;
  category: string;
  cuisine?: string;
  priceRange?: string;
  description?: string;
  website?: string;
  phone?: string;
  imageUrl?: string;
  rating?: number;
  coordinates?: { lat: number; lng: number };
  hours?: Record<string, { open: string | null; close: string | null }>;
  features?: string[];
  signatureDishes?: string[];
  vibe?: string[];
  whyVisit?: string;
  bestFor?: string[];
  editorialMentions?: Array<{ source: string; url: string; snippet: string }>;
  sourceConfidence: number;
  sources: string[];
  googlePlaceId?: string;
  lastVerifiedAt?: Date;
}

interface ScrapingResult {
  venuesFound: number;
  venuesSaved: number;
  venuesUpdated: number;
  venuesFailed: number;
  sources: {
    google: { found: number; saved: number };
    perplexity: { found: number; enriched: number };
    searxng: { listsFound: number; venuesExtracted: number };
  };
  duration: number;
  errors: string[];
}

/**
 * UnifiedScraperService
 *
 * Orchestrates venue data collection from multiple sources using the
 * Hybrid Multi-Source Strategy:
 *
 * Layer 1 (BASE): Google Maps API for structured data
 * Layer 2 (DISCOVER): SearXNG + Web Scrapers for editorial content
 * Layer 3 (ENRICH): Perplexity API for AI-generated descriptions
 *
 * @see docs/architecture/VENUE_SCRAPING_STRATEGY.md
 */
export class UnifiedScraperService {
  private static instance: UnifiedScraperService;
  private venueScraperService: VenueScraperService;
  private perplexityService: PerplexityAPIService;
  private searxngService: SearXNGService;

  private constructor() {
    this.venueScraperService = VenueScraperService.getInstance();
    this.perplexityService = PerplexityAPIService.getInstance();
    this.searxngService = SearXNGService.getInstance();
  }

  static getInstance(): UnifiedScraperService {
    if (!UnifiedScraperService.instance) {
      UnifiedScraperService.instance = new UnifiedScraperService();
    }
    return UnifiedScraperService.instance;
  }

  /**
   * Check service availability
   */
  async getServiceStatus(): Promise<{
    google: boolean;
    perplexity: boolean;
    searxng: boolean;
  }> {
    const [searxngAvailable] = await Promise.all([this.searxngService.isAvailable()]);

    return {
      google: !!process.env.GOOGLE_PLACES_API_KEY,
      perplexity: this.perplexityService.isConfigured(),
      searxng: searxngAvailable,
    };
  }

  /**
   * Run full scraping pipeline for a city
   */
  async scrapeCity(
    cityId: string,
    options: {
      useGoogle?: boolean;
      usePerplexity?: boolean;
      useSearxng?: boolean;
      categories?: string[];
      enrichTopN?: number;
      dryRun?: boolean;
    } = {}
  ): Promise<ScrapingResult> {
    const startTime = Date.now();
    const {
      useGoogle = true,
      usePerplexity = true,
      useSearxng = true,
      categories = ['restaurant', 'bar', 'cafe'],
      enrichTopN = 50,
      dryRun = false,
    } = options;

    const result: ScrapingResult = {
      venuesFound: 0,
      venuesSaved: 0,
      venuesUpdated: 0,
      venuesFailed: 0,
      sources: {
        google: { found: 0, saved: 0 },
        perplexity: { found: 0, enriched: 0 },
        searxng: { listsFound: 0, venuesExtracted: 0 },
      },
      duration: 0,
      errors: [],
    };

    try {
      // Get city details
      const cityResult = await pool.query('SELECT * FROM cities WHERE id = $1', [cityId]);
      if (cityResult.rows.length === 0) {
        throw new Error(`City ${cityId} not found`);
      }

      const city = cityResult.rows[0];
      const cityName = city.name;

      logger.info(`Starting unified scraping for ${cityName} (${cityId})`);

      // LAYER 1: Google Places API (base structured data)
      if (useGoogle && process.env.GOOGLE_PLACES_API_KEY) {
        logger.info(`Layer 1: Fetching base data from Google Places...`);
        try {
          for (const category of categories) {
            const count = await this.venueScraperService.scrapeVenues(cityId, category);
            result.sources.google.found += count;
            result.sources.google.saved += count;
          }
          result.venuesFound += result.sources.google.found;
          result.venuesSaved += result.sources.google.saved;
        } catch (error: any) {
          logger.error('Google Places scraping failed:', error.message);
          result.errors.push(`Google: ${error.message}`);
        }
      }

      // LAYER 2: SearXNG for editorial content discovery
      if (useSearxng) {
        logger.info(`Layer 2: Discovering editorial content via SearXNG...`);
        try {
          const isAvailable = await this.searxngService.isAvailable();
          if (isAvailable) {
            // Find editorial lists
            const lists = await this.searxngService.findEditorialLists(cityName);
            result.sources.searxng.listsFound = lists.length;

            logger.info(`Found ${lists.length} editorial lists for ${cityName}`);

            // Store editorial references for top venues
            for (const list of lists.slice(0, 10)) {
              await this.storeEditorialReference(cityId, list);
            }

            // Find new openings
            const newOpenings = await this.searxngService.findNewOpenings(cityName);
            logger.info(`Found ${newOpenings.length} new opening articles for ${cityName}`);
          } else {
            logger.warn('SearXNG not available, skipping editorial discovery');
          }
        } catch (error: any) {
          logger.error('SearXNG discovery failed:', error.message);
          result.errors.push(`SearXNG: ${error.message}`);
        }
      }

      // LAYER 3: Perplexity API enrichment for top venues
      if (usePerplexity && this.perplexityService.isConfigured()) {
        logger.info(`Layer 3: Enriching top ${enrichTopN} venues with Perplexity...`);
        try {
          // Get top venues that need enrichment
          const topVenues = await pool.query(
            `SELECT id, name, address, category, cuisine, description
             FROM venues
             WHERE city_id = $1
             AND (ai_description IS NULL OR ai_description = '')
             ORDER BY rating DESC NULLS LAST, created_at DESC
             LIMIT $2`,
            [cityId, enrichTopN]
          );

          for (const venue of topVenues.rows) {
            try {
              if (!dryRun) {
                const enrichment = await this.perplexityService.enrichVenue(venue.name, cityName, {
                  address: venue.address,
                  cuisine: venue.cuisine,
                  category: venue.category,
                });

                // Update venue with enrichment
                await pool.query(
                  `UPDATE venues SET
                     ai_description = $1,
                     signature_dishes = $2,
                     vibe = $3,
                     why_visit = $4,
                     best_for = $5,
                     enrichment_sources = $6,
                     enriched_at = NOW()
                   WHERE id = $7`,
                  [
                    enrichment.description,
                    JSON.stringify(enrichment.signatureDishes),
                    JSON.stringify(enrichment.vibe),
                    enrichment.whyVisit,
                    JSON.stringify(enrichment.bestFor),
                    JSON.stringify(enrichment.sources),
                    venue.id,
                  ]
                );

                result.sources.perplexity.enriched++;
              } else {
                logger.info(`[DRY RUN] Would enrich: ${venue.name}`);
              }

              // Rate limit
              await new Promise((resolve) => setTimeout(resolve, 1000));
            } catch (error: any) {
              logger.warn(`Failed to enrich ${venue.name}:`, error.message);
            }
          }
        } catch (error: any) {
          logger.error('Perplexity enrichment failed:', error.message);
          result.errors.push(`Perplexity: ${error.message}`);
        }
      }

      // BONUS: Use Perplexity to discover hidden gems
      if (usePerplexity && this.perplexityService.isConfigured()) {
        logger.info(`Discovering hidden gems via Perplexity...`);
        try {
          const discovery = await this.perplexityService.discoverVenues(cityName, {
            focusOn: 'hidden_gems',
            limit: 20,
          });

          result.sources.perplexity.found = discovery.venues.length;

          // Save discovered venues
          for (const venue of discovery.venues) {
            if (!dryRun) {
              await this.saveDiscoveredVenue(venue, cityId, cityName, 'perplexity');
            } else {
              logger.info(`[DRY RUN] Would save discovered venue: ${venue.name}`);
            }
          }
        } catch (error: any) {
          logger.error('Perplexity discovery failed:', error.message);
        }
      }
    } catch (error: any) {
      logger.error(`Unified scraping failed for city ${cityId}:`, error);
      result.errors.push(error.message);
    }

    result.duration = Date.now() - startTime;
    logger.info(
      `Unified scraping complete for ${cityId}: ${result.venuesFound} found, ${result.venuesSaved} saved, ${result.duration}ms`
    );

    return result;
  }

  /**
   * Discover new venues in a city using AI
   */
  async discoverNewVenues(
    cityId: string,
    options: {
      focusOn?: 'new_openings' | 'hidden_gems' | 'best_of' | 'trending';
      category?: string;
      limit?: number;
    } = {}
  ): Promise<{
    discovered: number;
    saved: number;
    venues: Array<{ name: string; description: string }>;
  }> {
    const { focusOn = 'hidden_gems', category = 'restaurants and bars', limit = 20 } = options;

    // Get city name
    const cityResult = await pool.query('SELECT name FROM cities WHERE id = $1', [cityId]);
    if (cityResult.rows.length === 0) {
      throw new Error(`City ${cityId} not found`);
    }

    const cityName = cityResult.rows[0].name;

    if (!this.perplexityService.isConfigured()) {
      throw new Error('Perplexity API not configured. Set PERPLEXITY_API_KEY.');
    }

    const discovery = await this.perplexityService.discoverVenues(cityName, {
      focusOn,
      category,
      limit,
    });

    let saved = 0;
    for (const venue of discovery.venues) {
      const result = await this.saveDiscoveredVenue(venue, cityId, cityName, 'perplexity');
      if (result) saved++;
    }

    return {
      discovered: discovery.venues.length,
      saved,
      venues: discovery.venues.map((v) => ({ name: v.name, description: v.description })),
    };
  }

  /**
   * Enrich a specific venue with AI-generated content
   */
  async enrichVenue(venueId: string): Promise<{
    success: boolean;
    enrichment?: {
      description: string;
      signatureDishes: string[];
      vibe: string[];
      whyVisit: string;
      bestFor: string[];
    };
    error?: string;
  }> {
    if (!this.perplexityService.isConfigured()) {
      return { success: false, error: 'Perplexity API not configured' };
    }

    // Get venue details
    const venueResult = await pool.query(
      `SELECT v.*, c.name as city_name
       FROM venues v
       JOIN cities c ON v.city_id = c.id
       WHERE v.id = $1`,
      [venueId]
    );

    if (venueResult.rows.length === 0) {
      return { success: false, error: 'Venue not found' };
    }

    const venue = venueResult.rows[0];

    try {
      const enrichment = await this.perplexityService.enrichVenue(venue.name, venue.city_name, {
        address: venue.address,
        cuisine: venue.cuisine,
        category: venue.category,
      });

      // Update venue
      await pool.query(
        `UPDATE venues SET
           ai_description = $1,
           signature_dishes = $2,
           vibe = $3,
           why_visit = $4,
           best_for = $5,
           enrichment_sources = $6,
           enriched_at = NOW()
         WHERE id = $7`,
        [
          enrichment.description,
          JSON.stringify(enrichment.signatureDishes),
          JSON.stringify(enrichment.vibe),
          enrichment.whyVisit,
          JSON.stringify(enrichment.bestFor),
          JSON.stringify(enrichment.sources),
          venueId,
        ]
      );

      return {
        success: true,
        enrichment,
      };
    } catch (error: any) {
      logger.error(`Failed to enrich venue ${venueId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Find and store editorial references for a city
   */
  async findEditorialContent(cityId: string): Promise<{
    lists: number;
    newOpenings: number;
  }> {
    const cityResult = await pool.query('SELECT name FROM cities WHERE id = $1', [cityId]);
    if (cityResult.rows.length === 0) {
      throw new Error(`City ${cityId} not found`);
    }

    const cityName = cityResult.rows[0].name;

    const [lists, newOpenings] = await Promise.all([
      this.searxngService.findEditorialLists(cityName),
      this.searxngService.findNewOpenings(cityName),
    ]);

    // Store references
    for (const list of lists) {
      await this.storeEditorialReference(cityId, list);
    }

    return {
      lists: lists.length,
      newOpenings: newOpenings.length,
    };
  }

  /**
   * Save a discovered venue to the database (idempotent)
   *
   * Deduplication strategy:
   * 1. Normalize name (trim, lowercase for comparison)
   * 2. Match by city_id + normalized name
   * 3. If found, MERGE data (don't overwrite existing with nulls)
   * 4. Track source for provenance
   */
  private async saveDiscoveredVenue(
    venue: {
      name: string;
      description: string;
      address?: string;
      cuisine?: string;
      priceRange?: string;
      signatureDish?: string;
      vibe?: string;
      whyVisit?: string;
    },
    cityId: string,
    cityName: string,
    source: string
  ): Promise<boolean> {
    try {
      const normalizedName = venue.name.trim();

      // Check for existing venue using normalized name comparison
      // Also check for similar names (fuzzy match) to prevent near-duplicates
      const existing = await pool.query(
        `SELECT id, signature_dishes, vibe, source FROM venues
         WHERE city_id = $1
         AND (
           LOWER(TRIM(name)) = LOWER($2)
           OR SIMILARITY(LOWER(name), LOWER($2)) > 0.8
         )
         ORDER BY SIMILARITY(LOWER(name), LOWER($2)) DESC
         LIMIT 1`,
        [cityId, normalizedName]
      );

      if (existing.rows.length > 0) {
        const existingVenue = existing.rows[0];

        // Merge arrays instead of replacing
        const existingDishes = existingVenue.signature_dishes || [];
        const existingVibe = existingVenue.vibe || [];
        const existingSources = existingVenue.source ? existingVenue.source.split(', ') : [];

        // Add new items to arrays (deduplicated)
        const newDishes = venue.signatureDish
          ? [...new Set([...existingDishes, venue.signatureDish])]
          : existingDishes;
        const newVibe = venue.vibe ? [...new Set([...existingVibe, venue.vibe])] : existingVibe;
        const newSources = [...new Set([...existingSources, source])].join(', ');

        // Update existing with merged AI content (COALESCE preserves existing non-null values)
        await pool.query(
          `UPDATE venues SET
             ai_description = COALESCE(NULLIF($1, ''), ai_description),
             signature_dishes = $2,
             vibe = $3,
             why_visit = COALESCE(NULLIF($4, ''), why_visit),
             source = $5,
             last_verified_at = NOW(),
             updated_at = NOW()
           WHERE id = $6`,
          [
            venue.description,
            JSON.stringify(newDishes),
            JSON.stringify(newVibe),
            venue.whyVisit,
            newSources,
            existingVenue.id,
          ]
        );
        logger.debug(
          `Updated existing venue: ${normalizedName} in ${cityName} (merged from ${source})`
        );
        return true;
      }

      // Create new venue with consistent ID format
      const id = `venue_${uuidv4().slice(0, 8)}`;
      await pool.query(
        `INSERT INTO venues (
           id, name, city_id, category, cuisine, price_range,
           description, ai_description, address,
           signature_dishes, vibe, why_visit, source,
           source_confidence, coordinates,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
         )`,
        [
          id,
          normalizedName,
          cityId,
          'restaurant',
          venue.cuisine || null,
          venue.priceRange || '$$',
          venue.description,
          venue.description,
          venue.address || null,
          venue.signatureDish ? JSON.stringify([venue.signatureDish]) : '[]',
          venue.vibe ? JSON.stringify([venue.vibe]) : '[]',
          venue.whyVisit || null,
          source,
          0.6, // AI-discovered venues start with moderate confidence
          JSON.stringify({ lat: 0, lng: 0 }), // Placeholder until geocoded
        ]
      );

      logger.info(`Saved discovered venue: ${normalizedName} in ${cityName} (${source})`);
      return true;
    } catch (error: any) {
      // Check if it's a unique constraint violation (race condition)
      if (error.code === '23505') {
        logger.debug(`Venue already exists (race condition): ${venue.name}`);
        return false;
      }
      logger.error(`Failed to save discovered venue ${venue.name} in ${cityName}:`, error);
      return false;
    }
  }

  /**
   * Store editorial reference in database
   */
  private async storeEditorialReference(
    cityId: string,
    list: {
      title: string;
      url: string;
      source: string;
      snippet: string;
      estimatedVenueCount?: number;
    }
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO editorial_references (
           id, city_id, title, url, source, snippet,
           estimated_venue_count, discovered_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (url) DO UPDATE SET
           title = $3,
           snippet = $6,
           discovered_at = NOW()`,
        [
          uuidv4(),
          cityId,
          list.title,
          list.url,
          list.source,
          list.snippet,
          list.estimatedVenueCount || null,
        ]
      );
    } catch (error: any) {
      // Ignore if table doesn't exist or other non-critical errors
      logger.debug(`Could not store editorial reference: ${error.message}`);
    }
  }
}

export default UnifiedScraperService;
