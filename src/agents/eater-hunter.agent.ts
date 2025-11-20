import { Pool } from 'pg';
import * as cheerio from 'cheerio';
import { HunterAgent, DataSource } from './hunter.agent';
import logger from '../services/logger.service';

/**
 * Eater Hunter - Scrapes Eater maps and lists
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
        cities: ['new-york', 'los-angeles', 'chicago', 'miami', 'las-vegas', 'san-francisco', 'seattle', 'austin', 'boston', 'washington-dc', 'atlanta', 'nashville', 'new-orleans', 'philly'],
        urlPattern: 'https://{city}.eater.com/maps/best-{city}-restaurants-38'
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
        // Handle special cases for city URLs if needed
        const citySlug = this.getCitySlug(city);
        const url = this.source.scrapeConfig.urlPattern.replace(/{city}/g, citySlug);
        
        const venueList = await this.scrapeEaterList(url, city);
        
        if (venueList.length > 0) {
            // Create the list record first
            await this.insertBronzeList({
                sourceListId: `eater-38-${city}`,
                sourceUrl: url,
                rawData: { url, city },
                name: `Eater 38 ${this.formatCityName(city)}`,
                description: `The 38 best restaurants in ${this.formatCityName(city)}`,
                city: this.formatCityName(city),
                category: 'restaurants',
                curator: 'Eater',
                venueCount: venueList.length,
                publishedDate: new Date()
            });

            for (const venue of venueList) {
                await this.insertBronzeVenue(venue);
            }
            
            logger.info(`Successfully scraped ${venueList.length} venues from Eater 38 ${city}`);
        } else {
            logger.warn(`No venues found for Eater 38 ${city} at ${url}`);
        }
        
        // Rate limiting
        await this.rateLimitDelay(3000);
        
      } catch (error) {
        logger.error(`Failed to scrape Eater 38 for ${city}`, error);
        this.metrics.recordsFailed++;
      }
    }
  }

  private getCitySlug(city: string): string {
      const map: {[key: string]: string} = {
          'new-york': 'ny',
          'washington-dc': 'dc'
      };
      return map[city] || city;
  }

  private formatCityName(citySlug: string): string {
      return citySlug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  private async scrapeEaterList(url: string, city: string): Promise<any[]> {
    try {
        const response = await this.httpClient.get(url);
        const $ = cheerio.load(response.data);
        const venues: any[] = [];

        // Try multiple selectors as Eater layout changes
        const cardSelectors = ['.c-mapstack__card', '.c-entry-box--compact'];
        let cards = null;

        for (const selector of cardSelectors) {
            const found = $(selector);
            if (found.length > 0) {
                cards = found;
                break;
            }
        }

        if (!cards) {
            logger.warn(`No cards found with known selectors for ${url}`);
            return [];
        }

        cards.each((_i, element) => {
            // Selectors for data
            const nameSelector = '.c-mapstack__card-hed h1, .c-entry-box--compact__title';
            const addressSelector = '.c-mapstack__address, .c-entry-box--compact__address';
            const phoneSelector = '.c-mapstack__phone';
            const contentSelector = '.c-entry-content, .c-entry-box--compact__body';

            const name = $(element).find(nameSelector).text().trim();
            
            // Skip if no name found
            if (!name) return;

            const address = $(element).find(addressSelector).text().trim();
            const phone = $(element).find(phoneSelector).text().trim();
            
            // Find website link
            let website = $(element).find('.c-mapstack__phone + a').attr('href');
            if (!website) {
                website = $(element).find('a:contains("Website")').attr('href');
            }

            const description = $(element).find(contentSelector).text().trim();
            
            // Extract coordinates if available
            const lat = $(element).data('lat');
            const lng = $(element).data('lng');

            venues.push({
                sourceVenueId: `eater-${city}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                sourceUrl: url,
                rawData: { name, address, phone, website, description },
                name,
                address: address || `${this.formatCityName(city)}`, // Fallback if address missing
                city: this.formatCityName(city),
                state: '', // Hard to extract reliably without address parsing
                postalCode: '',
                country: 'US',
                phone,
                website,
                category: 'restaurant',
                cuisine: this.guessCuisine(description),
                priceRange: this.guessPrice(description),
                rating: null, // Eater doesn't usually have ratings
                reviewCount: null,
                description,
                latitude: lat ? parseFloat(lat as string) : null,
                longitude: lng ? parseFloat(lng as string) : null
            });
        });

        return venues;
    } catch (error) {
        logger.error(`Error scraping URL ${url}:`, error);
        return [];
    }
  }

  private guessPrice(text: string): number | null {
      if (!text) return null;
      if (text.includes('$$$$')) return 4;
      if (text.includes('$$$')) return 3;
      if (text.includes('$$')) return 2;
      if (text.includes('$')) return 1;
      return null;
  }

  private guessCuisine(text: string): string | null {
      if (!text) return null;
      const lower = text.toLowerCase();
      const cuisines = ['italian', 'french', 'japanese', 'chinese', 'mexican', 'thai', 'indian', 'korean', 'vietnamese', 'american', 'burger', 'pizza', 'seafood', 'steak'];
      
      for (const cuisine of cuisines) {
          if (lower.includes(cuisine)) return cuisine.charAt(0).toUpperCase() + cuisine.slice(1);
      }
      return null;
  }
}

