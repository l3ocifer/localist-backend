import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import pool from '../config/database';
import logger from './logger.service';
import { v4 as uuidv4 } from 'uuid';

export interface ScrapedVenueData {
  name: string;
  address?: string;
  city?: string;
  cityId?: string;
  description?: string;
  cuisine?: string;
  category?: string;
  website?: string;
  phone?: string;
  coordinates?: { lat: number; lng: number };
  imageUrl?: string;
  sourceUrl: string;
  sourceVenueId: string;
  priceRange?: string;
  rating?: number;
}

/**
 * Base web scraper service using Cheerio
 */
export class WebScraperService {
  protected httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
  }

  /**
   * Fetch and parse HTML page with retry logic
   */
  async fetchPage(url: string, retries: number = 3): Promise<cheerio.CheerioAPI> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.httpClient.get(url, {
          timeout: 30000,
          validateStatus: (status) => status >= 200 && status < 400
        });
        
        if (!response.data) {
          throw new Error('Empty response body');
        }
        
        const $ = cheerio.load(response.data);
        return $ as unknown as cheerio.CheerioAPI;
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on 4xx errors (client errors)
        if (error.response?.status >= 400 && error.response?.status < 500) {
          logger.error(`Client error fetching ${url}: ${error.response.status}`);
          throw error;
        }
        
        // Retry on network errors or 5xx errors
        if (attempt < retries) {
          const delay = attempt * 2000; // Exponential backoff: 2s, 4s, 6s
          logger.warn(`Failed to fetch ${url} (attempt ${attempt}/${retries}), retrying in ${delay}ms...`);
          await this.delay(delay);
        }
      }
    }
    
    logger.error(`Failed to fetch page after ${retries} attempts: ${url}`, lastError);
    throw lastError;
  }

  /**
   * Rate limiting delay
   */
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extract cuisine type from text (shared across all scrapers)
   */
  protected extractCuisine(text: string): string | undefined {
    if (!text) return undefined;
    
    const cuisineKeywords: { [key: string]: string } = {
      'italian': 'Italian',
      'mexican': 'Mexican',
      'japanese': 'Japanese',
      'chinese': 'Chinese',
      'french': 'French',
      'american': 'American',
      'mediterranean': 'Mediterranean',
      'thai': 'Thai',
      'indian': 'Indian',
      'korean': 'Korean',
      'spanish': 'Spanish',
      'greek': 'Greek',
      'middle eastern': 'Middle Eastern',
      'vietnamese': 'Vietnamese',
      'sushi': 'Japanese',
      'pizza': 'Italian',
      'bbq': 'American',
      'steakhouse': 'American',
      'seafood': 'Seafood'
    };

    const lowerText = text.toLowerCase();
    for (const [keyword, cuisine] of Object.entries(cuisineKeywords)) {
      if (lowerText.includes(keyword)) {
        return cuisine;
      }
    }

    return undefined;
  }

  /**
   * Normalize phone number
   */
  protected normalizePhone(phone: string | undefined): string | null {
    if (!phone) return null;
    
    // Remove all non-digit characters except +
    const cleaned = phone.replace(/[^\d+]/g, '');
    
    // Basic validation - must have at least 10 digits
    const digits = cleaned.replace(/\D/g, '');
    if (digits.length < 10) return null;
    
    return cleaned;
  }

  /**
   * Normalize address
   */
  protected normalizeAddress(address: string | undefined): string | null {
    if (!address) return null;
    
    // Trim and normalize whitespace
    const normalized = address.trim().replace(/\s+/g, ' ');
    
    // Remove common address artifacts
    return normalized.length > 5 ? normalized : null;
  }

  /**
   * Save scraped venue to database (venues table)
   * Returns: { isNew: boolean, success: boolean }
   */
  protected async saveVenue(venue: ScrapedVenueData, cityId: string): Promise<{ isNew: boolean; success: boolean }> {
    try {
      // Validate required fields
      if (!venue.name || venue.name.trim().length < 2) {
        logger.warn(`Skipping venue with invalid name: ${venue.name}`);
        return { isNew: false, success: false };
      }

      // Normalize venue name
      const normalizedName = venue.name.trim();

      // Check if venue already exists
      let existing;
      
      if (venue.coordinates) {
        existing = await pool.query(
          `SELECT id FROM venues
           WHERE city_id = $1
           AND (
             (LOWER(TRIM(name)) = LOWER($2)) OR
             (coordinates IS NOT NULL AND
              ABS((coordinates->>'lat')::float - $3) < 0.001 AND
              ABS((coordinates->>'lng')::float - $4) < 0.001)
           )
           LIMIT 1`,
          [cityId, normalizedName, venue.coordinates.lat, venue.coordinates.lng]
        );
      } else {
        existing = await pool.query(
          'SELECT id FROM venues WHERE LOWER(TRIM(name)) = LOWER($1) AND city_id = $2 LIMIT 1',
          [normalizedName, cityId]
        );
      }

      if (existing.rows.length > 0) {
        // Update existing venue (only update non-null fields)
        await pool.query(
          `UPDATE venues SET
            rating = COALESCE($1, rating),
            phone = COALESCE(NULLIF($2, ''), phone),
            website = COALESCE(NULLIF($3, ''), website),
            image_url = COALESCE(NULLIF($4, ''), image_url),
            description = COALESCE(NULLIF($5, ''), description),
            address = COALESCE(NULLIF($6, ''), address),
            updated_at = NOW()
          WHERE id = $7`,
          [
            venue.rating || null,
            this.normalizePhone(venue.phone),
            venue.website ? this.normalizeUrl(venue.website, venue.sourceUrl) : null,
            venue.imageUrl ? this.normalizeUrl(venue.imageUrl, venue.sourceUrl) : null,
            venue.description || null,
            this.normalizeAddress(venue.address),
            existing.rows[0].id
          ]
        );
        return { isNew: false, success: true };
      }

      // Insert new venue
      const id = uuidv4();
      await pool.query(
        `INSERT INTO venues (
          id, name, city_id, category, cuisine, price_range, description,
          address, phone, website, image_url, rating, coordinates
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          normalizedName,
          cityId,
          venue.category || 'restaurant',
          venue.cuisine || null,
          venue.priceRange || '$$',
          venue.description || null,
          venue.address || null,
          venue.phone || null,
          venue.website ? this.normalizeUrl(venue.website) : null,
          venue.imageUrl ? this.normalizeUrl(venue.imageUrl) : null,
          venue.rating || null,
          venue.coordinates ? JSON.stringify(venue.coordinates) : null
        ]
      );

      logger.debug(`Saved new venue: ${normalizedName} from web scraping`);
      return { isNew: true, success: true };
    } catch (error) {
      logger.error(`Failed to save venue ${venue.name}`, error);
      return { isNew: false, success: false };
    }
  }

  /**
   * Normalize URL (handle relative URLs and validate)
   */
  protected normalizeUrl(url: string | undefined, baseUrl?: string): string | null {
    if (!url || url.trim().length === 0) return null;
    
    const trimmed = url.trim();
    
    // Already absolute URL - validate format
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        new URL(trimmed);
        return trimmed;
      } catch {
        logger.warn(`Invalid absolute URL: ${trimmed}`);
        return null;
      }
    }
    
    // Relative URL - prepend base URL if provided
    if (baseUrl && trimmed.startsWith('/')) {
      try {
        const base = new URL(baseUrl);
        return new URL(trimmed, base.origin).toString();
      } catch {
        logger.warn(`Failed to resolve relative URL: ${trimmed} with base: ${baseUrl}`);
        return null;
      }
    }
    
    // Protocol-relative URL (//example.com)
    if (trimmed.startsWith('//')) {
      return `https:${trimmed}`;
    }
    
    return null;
  }
}

/**
 * Eater.com scraper
 */
export class EaterScraper extends WebScraperService {
  /**
   * Scrape Eater city list and save to database
   */
  async scrapeCityList(citySlug: string, cityId: string): Promise<{ found: number; saved: number; updated: number; failed: number }> {
    const venues: ScrapedVenueData[] = [];
    const url = `https://www.eater.com/maps/${citySlug}`;

    try {
      logger.info(`Scraping Eater 38 for ${citySlug}`);
      const $ = await this.fetchPage(url);

      // Eater uses specific selectors - adjust based on actual HTML structure
      $('.c-mapstack__card, .venue-card, [data-venue], article').each((index, element) => {
        try {
          const $el = $(element);
          const name = $el.find('h2, h3, .venue-name, [data-venue-name], h1').first().text().trim();
          
          if (!name || name.length < 2) return;

          const address = $el.find('.address, [data-address], .c-mapstack__address').first().text().trim();
          const description = $el.find('.description, p, .c-entry-content').first().text().trim().substring(0, 500);
          const website = $el.find('a[href^="http"]').first().attr('href');
          const imageUrl = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');

          // Extract venue ID from data attributes or URL
          const venueId = $el.attr('data-venue-id') || 
                         $el.find('a').first().attr('href')?.split('/').pop() ||
                         `eater_${citySlug}_${index}`;

          venues.push({
            name,
            address,
            description,
            website,
            imageUrl,
            sourceUrl: url,
            sourceVenueId: venueId,
            category: 'restaurant',
            cuisine: this.extractCuisine(description || name),
            cityId
          });
        } catch (error) {
          logger.warn(`Failed to parse venue element in Eater scraper`, error);
        }
      });

      // If no venues found with expected selectors, try alternative patterns
      if (venues.length === 0) {
        logger.warn(`No venues found with standard selectors for ${citySlug}, trying alternatives`);
        // Try alternative selectors - look for headings that might be venue names
        $('h2, h3').each((index, element) => {
          const $el = $(element);
          const name = $el.text().trim();
          // Filter out common non-venue headings
          const skipPatterns = ['about', 'contact', 'menu', 'hours', 'location', 'directions', 'reviews'];
          const lowerName = name.toLowerCase();
          if (name && name.length > 2 && name.length < 100 && !skipPatterns.some(pattern => lowerName.includes(pattern))) {
            venues.push({
              name,
              sourceUrl: url,
              sourceVenueId: `eater_${citySlug}_alt_${index}`,
              category: 'restaurant',
              cityId
            });
          }
        });
      }

      // Save venues to database
      let saved = 0;
      let updated = 0;
      let failed = 0;
      for (const venue of venues) {
        const result = await this.saveVenue(venue, cityId);
        if (result.success) {
          if (result.isNew) {
            saved++;
          } else {
            updated++;
          }
        } else {
          failed++;
        }
      }

      logger.info(`Eater scraping complete: ${venues.length} found, ${saved} saved, ${updated} updated, ${failed} failed for ${citySlug}`);
      return { found: venues.length, saved, updated, failed };
    } catch (error) {
      logger.error(`Failed to scrape Eater for ${citySlug}`, error);
      return { found: venues.length, saved: 0, updated: 0, failed: 0 };
    }
  }

}

/**
 * Infatuation scraper
 */
export class InfatuationScraper extends WebScraperService {
  /**
   * Scrape Infatuation city list and save to database
   */
  async scrapeCityList(citySlug: string, cityId: string): Promise<{ found: number; saved: number; updated: number; failed: number }> {
    const venues: ScrapedVenueData[] = [];
    const url = `https://www.theinfatuation.com/${citySlug}/guides`;

    try {
      logger.info(`Scraping Infatuation for ${citySlug}`);
      const $ = await this.fetchPage(url);

      // Infatuation selectors - adjust based on actual structure
      $('.venue-item, .restaurant-card, [data-restaurant], article, .venue').each((index, element) => {
        try {
          const $el = $(element);
          const name = $el.find('h2, h3, .restaurant-name, h1').first().text().trim();
          
          if (!name || name.length < 2) return;

          const address = $el.find('.address, .location').first().text().trim();
          const description = $el.find('.description, .blurb, p').first().text().trim().substring(0, 500);
          const website = $el.find('a[href^="http"]').first().attr('href');
          const imageUrl = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');

          const venueId = $el.attr('data-restaurant-id') ||
                         $el.find('a').first().attr('href')?.split('/').pop() ||
                         `infatuation_${citySlug}_${index}`;

          venues.push({
            name,
            address,
            description,
            website,
            imageUrl,
            sourceUrl: url,
            sourceVenueId: venueId,
            category: 'restaurant',
            cuisine: this.extractCuisine(description || name),
            cityId
          });
        } catch (error) {
          logger.warn(`Failed to parse venue element`, error);
        }
      });

      // Save venues to database
      let saved = 0;
      let updated = 0;
      let failed = 0;
      for (const venue of venues) {
        const result = await this.saveVenue(venue, cityId);
        if (result.success) {
          if (result.isNew) {
            saved++;
          } else {
            updated++;
          }
        } else {
          failed++;
        }
      }

      logger.info(`Infatuation scraping complete: ${venues.length} found, ${saved} saved, ${updated} updated, ${failed} failed for ${citySlug}`);
      return { found: venues.length, saved, updated, failed };
    } catch (error) {
      logger.error(`Failed to scrape Infatuation for ${citySlug}`, error);
      return { found: venues.length, saved: 0, updated: 0, failed: 0 };
    }
  }

}

/**
 * Thrillist scraper
 */
export class ThrillistScraper extends WebScraperService {
  /**
   * Scrape Thrillist city list and save to database
   */
  async scrapeCityList(citySlug: string, cityId: string): Promise<{ found: number; saved: number; updated: number; failed: number }> {
    const venues: ScrapedVenueData[] = [];
    const url = `https://www.thrillist.com/eat/${citySlug}`;

    try {
      logger.info(`Scraping Thrillist for ${citySlug}`);
      const $ = await this.fetchPage(url);

      // Thrillist selectors - adjust based on actual structure
      $('.venue-card, .restaurant-item, [data-venue], article').each((index, element) => {
        try {
          const $el = $(element);
          const name = $el.find('h2, h3, .venue-title, h1').first().text().trim();
          
          if (!name || name.length < 2) return;

          const address = $el.find('.address, .location').first().text().trim();
          const description = $el.find('.description, .excerpt, p').first().text().trim().substring(0, 500);
          const website = $el.find('a[href^="http"]').first().attr('href');
          const imageUrl = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');

          const venueId = $el.attr('data-venue-id') ||
                         $el.find('a').first().attr('href')?.split('/').pop() ||
                         `thrillist_${citySlug}_${index}`;

          venues.push({
            name,
            address,
            description,
            website,
            imageUrl,
            sourceUrl: url,
            sourceVenueId: venueId,
            category: 'restaurant',
            cuisine: this.extractCuisine(description || name),
            cityId
          });
        } catch (error) {
          logger.warn(`Failed to parse venue element`, error);
        }
      });

      // Save venues to database
      let saved = 0;
      let updated = 0;
      for (const venue of venues) {
        const result = await this.saveVenue(venue, cityId);
        if (result.success) {
          if (result.isNew) {
            saved++;
          } else {
            updated++;
          }
        }
      }

      // Save venues to database
      let saved = 0;
      let updated = 0;
      let failed = 0;
      for (const venue of venues) {
        const result = await this.saveVenue(venue, cityId);
        if (result.success) {
          if (result.isNew) {
            saved++;
          } else {
            updated++;
          }
        } else {
          failed++;
        }
      }

      logger.info(`Thrillist scraping complete: ${venues.length} found, ${saved} saved, ${updated} updated, ${failed} failed for ${citySlug}`);
      return { found: venues.length, saved, updated, failed };
    } catch (error) {
      logger.error(`Failed to scrape Thrillist for ${citySlug}`, error);
      return { found: venues.length, saved: 0, updated: 0, failed: 0 };
    }
  }

}


