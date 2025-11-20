import { Pool } from 'pg';
import * as cheerio from 'cheerio';
import { HunterAgent, DataSource } from './hunter.agent';
import logger from '../services/logger.service';

/**
 * Infatuation Hunter
 */
export class InfatuationHunter extends HunterAgent {
    constructor(db: Pool) {
      const source: DataSource = {
        id: 'infatuation',
        name: 'The Infatuation',
        type: 'expert_list',
        authorityWeight: 0.85,
        url: 'https://www.theinfatuation.com',
        scrapeConfig: {
            cities: ['new-york', 'los-angeles', 'chicago', 'san-francisco', 'miami', 'london', 'seattle', 'austin', 'atlanta', 'philadelphia'],
            baseUrl: 'https://www.theinfatuation.com'
        },
        isActive: true
      };
  
      super('InfatuationHunter', source, {}, db);
    }
  
    async execute(): Promise<void> {
        const cities = this.source.scrapeConfig.cities as string[];
        const baseUrl = this.source.scrapeConfig.baseUrl;
        
        for (const city of cities) {
            logger.info(`Fetching Infatuation reviews for ${city}`);
            
            try {
                // Example URL pattern: https://www.theinfatuation.com/new-york/reviews
                const reviewIndexUrl = `${baseUrl}/${city}/reviews`;
                
                await this.scrapeReviewIndex(reviewIndexUrl, city);
                
                await this.rateLimitDelay(2000);
            } catch (error) {
                logger.error(`Failed to scrape Infatuation for ${city}`, error);
                this.metrics.recordsFailed++;
            }
        }
    }

    private async scrapeReviewIndex(url: string, city: string): Promise<void> {
        try {
            const response = await this.httpClient.get(url);
            const $ = cheerio.load(response.data);
            
            const venues: any[] = [];

            // Iterate over review cards
            $('a[data-testid="venue-link"]').each((_i, element) => {
                const name = $(element).find('h3').text().trim();
                const ratingText = $(element).find('[data-testid="rating"]').text().trim();
                const description = $(element).find('p').text().trim();
                const link = $(element).attr('href');
                const fullUrl = link?.startsWith('http') ? link : `${this.source.scrapeConfig.baseUrl}${link}`;

                if (name) {
                    venues.push({
                        sourceVenueId: `infatuation-${city}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                        sourceUrl: fullUrl,
                        rawData: { name, ratingText, description, link: fullUrl },
                        name,
                        address: '', // Will be enriched
                        city: this.formatCityName(city),
                        country: 'US',
                        rating: this.parseRating(ratingText),
                        description,
                        category: 'restaurant'
                    });
                }
            });

            logger.info(`Found ${venues.length} venues on Infatuation ${city} index`);

            for (const venue of venues) {
                // Try to fetch details to get address
                if (venue.sourceUrl) {
                    try {
                        const details = await this.scrapeVenueDetails(venue.sourceUrl);
                        if (details) {
                            venue.address = details.address || venue.address;
                            venue.phone = details.phone;
                            venue.website = details.website;
                            // Merge extra details
                            venue.rawData = { ...venue.rawData, ...details };
                        }
                        await this.rateLimitDelay(500); // Small delay between details
                    } catch (err) {
                        logger.warn(`Failed to fetch details for ${venue.name}`, err);
                    }
                }

                await this.insertBronzeVenue(venue);
            }

        } catch (error) {
            logger.error(`Error scraping Infatuation URL ${url}:`, error);
        }
    }

    private async scrapeVenueDetails(url: string): Promise<any> {
        try {
            const response = await this.httpClient.get(url);
            const $ = cheerio.load(response.data);
            
            // Common selectors for Infatuation detail pages
            const address = $('[data-testid="venue-address"]').text().trim() || 
                           $('.address').text().trim() || 
                           $('address').text().trim();
                           
            const phone = $('a[href^="tel:"]').first().text().trim();
            const website = $('a[href^="http"]:contains("Website")').attr('href');

            return { address, phone, website };
        } catch (error) {
            return null;
        }
    }

    private parseRating(text: string): number | null {
        if (!text) return null;
        const match = text.match(/(\d+(\.\d+)?)/);
        if (match) {
            return parseFloat(match[1]);
        }
        return null;
    }

    private formatCityName(citySlug: string): string {
        return citySlug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }
}
