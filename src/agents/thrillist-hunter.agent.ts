import { Pool } from 'pg';
import * as cheerio from 'cheerio';
import { HunterAgent, DataSource } from './hunter.agent';
import logger from '../services/logger.service';

/**
 * Thrillist Hunter
 */
export class ThrillistHunter extends HunterAgent {
    constructor(db: Pool) {
      const source: DataSource = {
        id: 'thrillist',
        name: 'Thrillist',
        type: 'expert_list',
        authorityWeight: 0.80,
        url: 'https://www.thrillist.com',
        scrapeConfig: {
            cities: ['nyc', 'los-angeles', 'chicago', 'san-francisco', 'miami', 'las-vegas'],
            baseUrl: 'https://www.thrillist.com'
        },
        isActive: true
      };
  
      super('ThrillistHunter', source, {}, db);
    }
  
    async execute(): Promise<void> {
         const cities = this.source.scrapeConfig.cities as string[];
        
        for (const city of cities) {
            logger.info(`Fetching Thrillist lists for ${city}`);
            
            try {
                const cityHubUrl = `${this.source.scrapeConfig.baseUrl}/${city}/food-and-drink`;
                
                await this.scrapeCityHub(cityHubUrl, city);
                await this.rateLimitDelay(2000);

            } catch (error) {
                logger.error(`Failed to scrape Thrillist for ${city}`, error);
                this.metrics.recordsFailed++;
            }
        }
    }

    private async scrapeCityHub(url: string, city: string): Promise<void> {
        try {
            const response = await this.httpClient.get(url);
            const $ = cheerio.load(response.data);
            
            const listLinks: string[] = [];
            $('a').each((_i, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().toLowerCase();
                if (href && (text.includes('best restaurant') || text.includes('best food')) && !href.includes('video')) {
                    listLinks.push(href.startsWith('http') ? href : `${this.source.scrapeConfig.baseUrl}${href}`);
                }
            });

            const uniqueLinks = [...new Set(listLinks)].slice(0, 3);
            
            for (const link of uniqueLinks) {
                await this.scrapeArticle(link, city);
                await this.rateLimitDelay(1000);
            }

        } catch (error) {
            logger.error(`Error scraping Thrillist hub ${url}:`, error);
        }
    }

    private async scrapeArticle(url: string, city: string): Promise<void> {
        try {
            logger.info(`Scraping Thrillist article: ${url}`);
            const response = await this.httpClient.get(url);
            const $ = cheerio.load(response.data);
            
            const title = $('h1').text().trim();
            
            // Extract venues first
            const venues: any[] = [];
            
            $('.venue-name, h2').each((_i, el) => {
                const name = $(el).text().trim();
                if (name.length > 50 || name.includes('Best') || name.includes('The')) return;

                let address = $(el).next().text().trim();
                if (address.length > 100) address = ''; 

                if (name) {
                     venues.push({
                        sourceVenueId: `thrillist-${city}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                        sourceUrl: url,
                        rawData: { name, address },
                        name,
                        address,
                        city: this.formatCityName(city),
                        country: 'US',
                        category: 'restaurant',
                        description: $(el).next('p').text().trim()
                    });
                }
            });

            // Create list record with correct count
            await this.insertBronzeList({
                sourceListId: `thrillist-${url}`,
                sourceUrl: url,
                rawData: { title, url },
                name: title,
                description: $('meta[name="description"]').attr('content') || title,
                city: this.formatCityName(city),
                category: 'restaurant',
                curator: 'Thrillist',
                venueCount: venues.length, // Correct count
                publishedDate: new Date()
            });

             for (const venue of venues) {
                await this.insertBronzeVenue(venue);
            }

            logger.info(`Scraped ${venues.length} venues from ${title}`);

        } catch (error) {
            logger.error(`Error scraping Thrillist article ${url}:`, error);
        }
    }

    private formatCityName(citySlug: string): string {
        return citySlug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }
}
