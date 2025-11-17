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
   * Fetch and parse HTML page
   */
  async fetchPage(url: string): Promise<cheerio.CheerioAPI> {
    try {
      const response = await this.httpClient.get(url);
      const $ = cheerio.load(response.data);
      return $ as unknown as cheerio.CheerioAPI;
    } catch (error) {
      logger.error(`Failed to fetch page: ${url}`, error);
      throw error;
    }
  }

  /**
   * Rate limiting delay
   */
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Save scraped venue to database (venues table)
   */
  protected async saveVenue(venue: ScrapedVenueData, cityId: string): Promise<boolean> {
    try {
      // Check if venue already exists
      let existing;
      
      if (venue.coordinates) {
        existing = await pool.query(
          `SELECT id FROM venues
           WHERE city_id = $1
           AND (
             (LOWER(name) = LOWER($2)) OR
             (coordinates IS NOT NULL AND
              ABS((coordinates->>'lat')::float - $3) < 0.001 AND
              ABS((coordinates->>'lng')::float - $4) < 0.001)
           )`,
          [cityId, venue.name, venue.coordinates.lat, venue.coordinates.lng]
        );
      } else {
        existing = await pool.query(
          'SELECT id FROM venues WHERE LOWER(name) = LOWER($1) AND city_id = $2',
          [venue.name, cityId]
        );
      }

      if (existing.rows.length > 0) {
        // Update existing venue
        await pool.query(
          `UPDATE venues SET
            rating = COALESCE($1, rating),
            phone = COALESCE($2, phone),
            website = COALESCE($3, website),
            image_url = COALESCE($4, image_url),
            description = COALESCE($5, description),
            updated_at = NOW()
          WHERE id = $6`,
          [
            venue.rating,
            venue.phone,
            venue.website,
            venue.imageUrl,
            venue.description,
            existing.rows[0].id
          ]
        );
        return false; // Not a new venue
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
          venue.name,
          cityId,
          venue.category || 'restaurant',
          venue.cuisine,
          venue.priceRange || '$$',
          venue.description,
          venue.address,
          venue.phone,
          venue.website,
          venue.imageUrl,
          venue.rating,
          venue.coordinates ? JSON.stringify(venue.coordinates) : null
        ]
      );

      logger.info(`Saved venue: ${venue.name} from web scraping`);
      return true;
    } catch (error) {
      logger.error(`Failed to save venue ${venue.name}`, error);
      return false;
    }
  }
}

/**
 * Eater.com scraper
 */
export class EaterScraper extends WebScraperService {
  /**
   * Scrape Eater city list and save to database
   */
  async scrapeCityList(citySlug: string, cityId: string): Promise<{ found: number; saved: number }> {
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
          logger.warn(`Failed to parse venue element`, error);
        }
      });

      // If no venues found with expected selectors, try alternative patterns
      if (venues.length === 0) {
        logger.warn(`No venues found with standard selectors for ${citySlug}, trying alternatives`);
        // Try alternative selectors
        $('h2, h3').each((index, element) => {
          const $el = $(element);
          const name = $el.text().trim();
          if (name && name.length > 2 && name.length < 100) {
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
      for (const venue of venues) {
        const wasNew = await this.saveVenue(venue, cityId);
        if (wasNew) saved++;
      }

      logger.info(`Eater scraping complete: ${venues.length} found, ${saved} saved for ${citySlug}`);
      return { found: venues.length, saved };
    } catch (error) {
      logger.error(`Failed to scrape Eater for ${citySlug}`, error);
      return { found: venues.length, saved: 0 };
    }
  }

  private extractCuisine(text: string): string | undefined {
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
      'korean': 'Korean'
    };

    const lowerText = text.toLowerCase();
    for (const [keyword, cuisine] of Object.entries(cuisineKeywords)) {
      if (lowerText.includes(keyword)) {
        return cuisine;
      }
    }

    return undefined;
  }
}

/**
 * Infatuation scraper
 */
export class InfatuationScraper extends WebScraperService {
  /**
   * Scrape Infatuation city list and save to database
   */
  async scrapeCityList(citySlug: string, cityId: string): Promise<{ found: number; saved: number }> {
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
      for (const venue of venues) {
        const wasNew = await this.saveVenue(venue, cityId);
        if (wasNew) saved++;
      }

      logger.info(`Infatuation scraping complete: ${venues.length} found, ${saved} saved for ${citySlug}`);
      return { found: venues.length, saved };
    } catch (error) {
      logger.error(`Failed to scrape Infatuation for ${citySlug}`, error);
      return { found: venues.length, saved: 0 };
    }
  }

  private extractCuisine(text: string): string | undefined {
    // Similar cuisine extraction as Eater
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
      'korean': 'Korean'
    };

    const lowerText = text.toLowerCase();
    for (const [keyword, cuisine] of Object.entries(cuisineKeywords)) {
      if (lowerText.includes(keyword)) {
        return cuisine;
      }
    }

    return undefined;
  }
}

/**
 * Thrillist scraper
 */
export class ThrillistScraper extends WebScraperService {
  /**
   * Scrape Thrillist city list and save to database
   */
  async scrapeCityList(citySlug: string, cityId: string): Promise<{ found: number; saved: number }> {
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
      for (const venue of venues) {
        const wasNew = await this.saveVenue(venue, cityId);
        if (wasNew) saved++;
      }

      logger.info(`Thrillist scraping complete: ${venues.length} found, ${saved} saved for ${citySlug}`);
      return { found: venues.length, saved };
    } catch (error) {
      logger.error(`Failed to scrape Thrillist for ${citySlug}`, error);
      return { found: venues.length, saved: 0 };
    }
  }

  private extractCuisine(text: string): string | undefined {
    // Similar cuisine extraction
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
      'korean': 'Korean'
    };

    const lowerText = text.toLowerCase();
    for (const [keyword, cuisine] of Object.entries(cuisineKeywords)) {
      if (lowerText.includes(keyword)) {
        return cuisine;
      }
    }

    return undefined;
  }
}

