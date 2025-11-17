import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import logger from './logger.service';

export interface ScrapedVenueData {
  name: string;
  address?: string;
  city?: string;
  description?: string;
  cuisine?: string;
  category?: string;
  website?: string;
  phone?: string;
  coordinates?: { lat: number; lng: number };
  imageUrl?: string;
  sourceUrl: string;
  sourceVenueId: string;
}

/**
 * Base web scraper service using Cheerio
 */
export class WebScraperService {
  private httpClient: AxiosInstance;

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
}

/**
 * Eater.com scraper
 */
export class EaterScraper extends WebScraperService {
  async scrapeCityList(citySlug: string): Promise<ScrapedVenueData[]> {
    const venues: ScrapedVenueData[] = [];
    const url = `https://www.eater.com/maps/${citySlug}`;

    try {
      logger.info(`Scraping Eater 38 for ${citySlug}`);
      const $ = await this.fetchPage(url);

      // Eater uses specific selectors - adjust based on actual HTML structure
      $('.c-mapstack__card, .venue-card, [data-venue]').each((index, element) => {
        try {
          const $el = $(element);
          const name = $el.find('h2, h3, .venue-name, [data-venue-name]').first().text().trim();
          
          if (!name) return;

          const address = $el.find('.address, [data-address]').first().text().trim();
          const description = $el.find('.description, p').first().text().trim();
          const website = $el.find('a[href^="http"]').first().attr('href');
          const imageUrl = $el.find('img').first().attr('src');

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
            cuisine: this.extractCuisine(description)
          });
        } catch (error) {
          logger.warn(`Failed to parse venue element`, error);
        }
      });

      // If no venues found with expected selectors, try alternative patterns
      if (venues.length === 0) {
        logger.warn(`No venues found with standard selectors for ${citySlug}, trying alternatives`);
        // Alternative scraping logic can be added here
      }

      logger.info(`Found ${venues.length} venues from Eater for ${citySlug}`);
      return venues;
    } catch (error) {
      logger.error(`Failed to scrape Eater for ${citySlug}`, error);
      return venues;
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
  async scrapeCityList(citySlug: string): Promise<ScrapedVenueData[]> {
    const venues: ScrapedVenueData[] = [];
    const url = `https://www.theinfatuation.com/${citySlug}/guides`;

    try {
      logger.info(`Scraping Infatuation for ${citySlug}`);
      const $ = await this.fetchPage(url);

      // Infatuation selectors - adjust based on actual structure
      $('.venue-item, .restaurant-card, [data-restaurant]').each((index, element) => {
        try {
          const $el = $(element);
          const name = $el.find('h2, h3, .restaurant-name').first().text().trim();
          
          if (!name) return;

          const address = $el.find('.address, .location').first().text().trim();
          const description = $el.find('.description, .blurb').first().text().trim();
          const website = $el.find('a[href^="http"]').first().attr('href');
          const imageUrl = $el.find('img').first().attr('src');

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
            cuisine: this.extractCuisine(description)
          });
        } catch (error) {
          logger.warn(`Failed to parse venue element`, error);
        }
      });

      logger.info(`Found ${venues.length} venues from Infatuation for ${citySlug}`);
      return venues;
    } catch (error) {
      logger.error(`Failed to scrape Infatuation for ${citySlug}`, error);
      return venues;
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
  async scrapeCityList(citySlug: string): Promise<ScrapedVenueData[]> {
    const venues: ScrapedVenueData[] = [];
    const url = `https://www.thrillist.com/eat/${citySlug}`;

    try {
      logger.info(`Scraping Thrillist for ${citySlug}`);
      const $ = await this.fetchPage(url);

      // Thrillist selectors - adjust based on actual structure
      $('.venue-card, .restaurant-item, [data-venue]').each((index, element) => {
        try {
          const $el = $(element);
          const name = $el.find('h2, h3, .venue-title').first().text().trim();
          
          if (!name) return;

          const address = $el.find('.address, .location').first().text().trim();
          const description = $el.find('.description, .excerpt').first().text().trim();
          const website = $el.find('a[href^="http"]').first().attr('href');
          const imageUrl = $el.find('img').first().attr('src');

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
            cuisine: this.extractCuisine(description)
          });
        } catch (error) {
          logger.warn(`Failed to parse venue element`, error);
        }
      });

      logger.info(`Found ${venues.length} venues from Thrillist for ${citySlug}`);
      return venues;
    } catch (error) {
      logger.error(`Failed to scrape Thrillist for ${citySlug}`, error);
      return venues;
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

