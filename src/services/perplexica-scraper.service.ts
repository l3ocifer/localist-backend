import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import logger from './logger.service';

interface PerplexicaSearchResult {
  message: string;
  sources: Array<{
    title: string;
    url: string;
    snippet?: string;
  }>;
}

interface VenueData {
  name: string;
  address: string;
  city_id: string;
  category: string;
  cuisine?: string;
  price_range?: string;
  description?: string;
  website?: string;
  image_url?: string;
  rating?: number;
  coordinates?: { lat: number; lng: number };
  features?: string[];
  source_url?: string;
}

/**
 * PerplexicaScraperService
 *
 * Uses Perplexica's AI-powered search to discover and enrich venue data.
 * Perplexica combines web search (via SearXNG) with LLM analysis for
 * structured data extraction.
 */
export class PerplexicaScraperService {
  private static instance: PerplexicaScraperService;
  private baseUrl: string;
  private defaultChatModel = { providerId: 'openai', key: 'gpt-4o-mini' };
  private defaultEmbeddingModel = { providerId: 'openai', key: 'text-embedding-3-small' };

  private constructor() {
    this.baseUrl = process.env.PERPLEXICA_URL || 'http://localhost:3002';
  }

  static getInstance(): PerplexicaScraperService {
    if (!PerplexicaScraperService.instance) {
      PerplexicaScraperService.instance = new PerplexicaScraperService();
    }
    return PerplexicaScraperService.instance;
  }

  /**
   * Search for venues using Perplexica's AI search
   */
  async searchVenues(
    query: string,
    focusMode: string = 'webSearch'
  ): Promise<PerplexicaSearchResult> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/search`, {
        query,
        focusMode,
        chatModel: this.defaultChatModel,
        embeddingModel: this.defaultEmbeddingModel,
        optimizationMode: 'balanced',
        history: [],
        stream: false,
        systemInstructions: `You are a venue discovery assistant. Extract structured information about restaurants, bars, cafes, and entertainment venues. For each venue mentioned, identify:
- Name
- Address
- Category (restaurant, bar, cafe, club, etc.)
- Cuisine type
- Price range ($, $$, $$$, $$$$)
- Notable features
- Website if available
Format as a structured list.`,
      });

      return response.data;
    } catch (error: any) {
      logger.error('Perplexica search error:', error.message);
      throw error;
    }
  }

  /**
   * Discover venues in a city using AI search
   */
  async discoverVenuesInCity(
    cityId: string,
    cityName: string,
    categories: string[] = ['restaurants', 'bars', 'cafes']
  ): Promise<VenueData[]> {
    const venues: VenueData[] = [];

    for (const category of categories) {
      try {
        const queries = [
          `best ${category} in ${cityName} 2024`,
          `top rated ${category} ${cityName} must visit`,
          `hidden gem ${category} ${cityName} locals recommend`,
          `new ${category} opening ${cityName}`,
        ];

        for (const query of queries) {
          logger.info(`Perplexica searching: "${query}"`);

          const result = await this.searchVenues(query);
          const parsedVenues = await this.parseVenuesFromResponse(result, cityId, category);

          for (const venue of parsedVenues) {
            // Deduplicate by name similarity
            const exists = venues.some((v) => v.name.toLowerCase() === venue.name.toLowerCase());
            if (!exists) {
              venues.push(venue);
            }
          }

          // Rate limit between queries
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error: any) {
        logger.error(`Error discovering ${category} in ${cityName}:`, error.message);
      }
    }

    logger.info(`Discovered ${venues.length} venues in ${cityName}`);
    return venues;
  }

  /**
   * Parse venue data from Perplexica's AI response
   */
  private async parseVenuesFromResponse(
    result: PerplexicaSearchResult,
    cityId: string,
    defaultCategory: string
  ): Promise<VenueData[]> {
    const venues: VenueData[] = [];

    // Use AI to extract structured data from the response
    try {
      const extractionQuery = `Extract venue information from this text. Return ONLY a JSON array of venues with fields: name, address, category, cuisine, price_range, description, website. Text: ${result.message}`;

      const extractionResult = await this.searchVenues(extractionQuery, 'webSearch');

      // Try to parse JSON from the response
      const jsonMatch = extractionResult.message.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        for (const v of parsed) {
          if (v.name) {
            venues.push({
              name: v.name,
              address: v.address || '',
              city_id: cityId,
              category: v.category || defaultCategory,
              cuisine: v.cuisine,
              price_range: v.price_range,
              description: v.description,
              website: v.website,
              source_url: result.sources?.[0]?.url,
            });
          }
        }
      }
    } catch (error) {
      // Fall back to basic extraction from sources
      for (const source of result.sources || []) {
        if (source.title && source.title.length > 3) {
          venues.push({
            name: source.title,
            address: '',
            city_id: cityId,
            category: defaultCategory,
            description: source.snippet,
            website: source.url,
            source_url: source.url,
          });
        }
      }
    }

    return venues;
  }

  /**
   * Enrich existing venue data with AI search
   */
  async enrichVenueData(venueId: string): Promise<VenueData | null> {
    try {
      // Get existing venue
      const venueResult = await pool.query('SELECT * FROM venues WHERE id = $1', [venueId]);

      if (venueResult.rows.length === 0) {
        return null;
      }

      const venue = venueResult.rows[0];
      const query = `${venue.name} ${venue.address || ''} restaurant reviews hours menu`;

      const result = await this.searchVenues(query);

      // Extract additional info
      const enrichedData: Partial<VenueData> = {
        description: venue.description || result.message.slice(0, 500),
        website: result.sources?.[0]?.url,
      };

      // Update venue with enriched data
      await pool.query(
        `UPDATE venues SET
         description = COALESCE($1, description),
         website = COALESCE($2, website),
         updated_at = NOW()
         WHERE id = $3`,
        [enrichedData.description, enrichedData.website, venueId]
      );

      return { ...venue, ...enrichedData } as VenueData;
    } catch (error: any) {
      logger.error(`Error enriching venue ${venueId}:`, error.message);
      return null;
    }
  }

  /**
   * Save discovered venues to database
   */
  async saveDiscoveredVenues(venues: VenueData[]): Promise<number> {
    let savedCount = 0;

    for (const venue of venues) {
      try {
        const id = `venue_${uuidv4().slice(0, 8)}`;

        await pool.query(
          `INSERT INTO venues (
            id, name, city_id, category, cuisine, price_range,
            description, website, coordinates, features, source
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO NOTHING`,
          [
            id,
            venue.name,
            venue.city_id,
            venue.category,
            venue.cuisine,
            venue.price_range || '$$',
            venue.description,
            venue.website,
            JSON.stringify(venue.coordinates || { lat: 0, lng: 0 }),
            JSON.stringify(venue.features || []),
            'perplexica',
          ]
        );

        savedCount++;
      } catch (error: any) {
        logger.error(`Error saving venue ${venue.name}:`, error.message);
      }
    }

    logger.info(`Saved ${savedCount}/${venues.length} venues from Perplexica`);
    return savedCount;
  }

  /**
   * Run a full discovery job for a city
   */
  async runDiscoveryJob(
    cityId: string,
    cityName: string
  ): Promise<{
    discovered: number;
    saved: number;
  }> {
    logger.info(`Starting Perplexica discovery job for ${cityName}`);

    const venues = await this.discoverVenuesInCity(cityId, cityName, [
      'restaurants',
      'bars',
      'cafes',
      'clubs',
      'breweries',
      'food trucks',
    ]);

    const saved = await this.saveDiscoveredVenues(venues);

    return {
      discovered: venues.length,
      saved,
    };
  }
}

export default PerplexicaScraperService;
