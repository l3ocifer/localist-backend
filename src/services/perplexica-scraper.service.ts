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
  // Default to Ollama models (local/homelab) - can override with PERPLEXICA_CHAT_MODEL env var
  // Ollama models available on homelab: gemma3:27b, qwen2.5-coder:32b, llama3.2:3b
  private defaultChatModel: { providerId: string; key: string };
  private defaultEmbeddingModel: { providerId: string; key: string };

  private constructor() {
    this.baseUrl = process.env.PERPLEXICA_URL || 'http://localhost:3002';

    // Use Ollama by default, fall back to OpenAI if OPENAI_API_KEY is set
    const useOpenAI = !!process.env.OPENAI_API_KEY;
    this.defaultChatModel = {
      providerId: process.env.PERPLEXICA_CHAT_PROVIDER || (useOpenAI ? 'openai' : 'ollama'),
      key: process.env.PERPLEXICA_CHAT_MODEL || (useOpenAI ? 'gpt-4o-mini' : 'llama3.2:3b'),
    };
    this.defaultEmbeddingModel = {
      providerId: process.env.PERPLEXICA_EMBED_PROVIDER || (useOpenAI ? 'openai' : 'ollama'),
      key:
        process.env.PERPLEXICA_EMBED_MODEL ||
        (useOpenAI ? 'text-embedding-3-small' : 'nomic-embed-text'),
    };
  }

  static getInstance(): PerplexicaScraperService {
    if (!PerplexicaScraperService.instance) {
      PerplexicaScraperService.instance = new PerplexicaScraperService();
    }
    return PerplexicaScraperService.instance;
  }

  /**
   * Check if Perplexica is configured and available
   */
  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  /**
   * Discover venues (wrapper for unified scraper compatibility)
   */
  async discoverVenues(
    cityName: string,
    options: { focusOn?: string; category?: string; limit?: number } = {}
  ): Promise<{ venues: VenueData[]; sources: string[] }> {
    const categories = options.category ? [options.category] : ['restaurants', 'bars', 'cafes'];
    const venues = await this.discoverVenuesInCity('', cityName, categories);
    return {
      venues: venues.slice(0, options.limit || 20),
      sources: ['perplexica'],
    };
  }

  /**
   * Enrich a venue with AI-generated content (wrapper for unified scraper compatibility)
   */
  async enrichVenue(
    venueName: string,
    cityName: string,
    context: { address?: string; cuisine?: string; category?: string } = {}
  ): Promise<{
    description: string;
    signatureDishes: string[];
    vibe: string[];
    whyVisit: string;
    bestFor: string[];
  }> {
    const query = `Tell me about ${venueName} in ${cityName}. ${
      context.cuisine ? `It's a ${context.cuisine} place.` : ''
    }
    Provide: a brief description, signature dishes/drinks, the vibe/atmosphere, why someone should visit, and what it's best for.`;

    try {
      const result = await this.searchVenues(query);

      // Parse the AI response for structured data
      const response = result.message || '';

      return {
        description: response.substring(0, 500),
        signatureDishes: this.extractList(response, [
          'signature',
          'famous for',
          'known for',
          'must-try',
        ]),
        vibe: this.extractList(response, ['vibe', 'atmosphere', 'ambiance', 'feel']),
        whyVisit: this.extractSentence(response, ['should visit', 'worth visiting', 'go for']),
        bestFor: this.extractList(response, ['best for', 'perfect for', 'ideal for', 'great for']),
      };
    } catch (error: any) {
      logger.error(`Failed to enrich venue ${venueName}:`, error.message);
      return {
        description: '',
        signatureDishes: [],
        vibe: [],
        whyVisit: '',
        bestFor: [],
      };
    }
  }

  private extractList(text: string, keywords: string[]): string[] {
    const results: string[] = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (keywords.some((k) => lowerLine.includes(k))) {
        // Extract items after the keyword
        const items = line
          .split(/[,;:]/)
          .slice(1)
          .map((s) => s.trim())
          .filter((s) => s.length > 2);
        results.push(...items);
      }
    }
    return results.slice(0, 5);
  }

  private extractSentence(text: string, keywords: string[]): string {
    const sentences = text.split(/[.!?]/);
    for (const sentence of sentences) {
      if (keywords.some((k) => sentence.toLowerCase().includes(k))) {
        return sentence.trim();
      }
    }
    return '';
  }

  /**
   * Find "Best Of" lists for a city
   */
  async findBestOfLists(
    cityName: string,
    year: number = new Date().getFullYear()
  ): Promise<{
    lists: Array<{ title: string; url: string; publication: string }>;
    sources: string[];
  }> {
    const query = `Best restaurants ${cityName} ${year} lists from Eater, Infatuation, Thrillist, Time Out`;

    try {
      const result = await this.searchVenues(query);
      const lists: Array<{ title: string; url: string; publication: string }> = [];

      // Parse sources for editorial lists
      if (result.sources) {
        for (const source of result.sources) {
          const url = source.url || '';
          const title = source.title || '';
          let publication = 'Unknown';

          if (url.includes('eater.com')) publication = 'Eater';
          else if (url.includes('theinfatuation.com')) publication = 'The Infatuation';
          else if (url.includes('thrillist.com')) publication = 'Thrillist';
          else if (url.includes('timeout.com')) publication = 'Time Out';

          if (publication !== 'Unknown') {
            lists.push({ title, url, publication });
          }
        }
      }

      return {
        lists,
        sources: ['perplexica'],
      };
    } catch (error: any) {
      logger.error(`Failed to find best of lists for ${cityName}:`, error.message);
      return { lists: [], sources: [] };
    }
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
