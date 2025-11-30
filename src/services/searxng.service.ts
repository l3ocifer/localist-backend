import axios, { AxiosInstance } from 'axios';
import logger from './logger.service';

interface SearXNGResult {
  title: string;
  url: string;
  content: string;
  engine: string;
  score?: number;
  category?: string;
  publishedDate?: string;
  thumbnail?: string;
}

interface SearXNGResponse {
  query: string;
  number_of_results: number;
  results: SearXNGResult[];
  infoboxes?: Array<{
    infobox: string;
    content: string;
    urls?: Array<{ title: string; url: string }>;
  }>;
  suggestions?: string[];
}

interface VenueSearchResult {
  name: string;
  url: string;
  snippet: string;
  source: string;
  publishedDate?: string;
  relevanceScore: number;
}

interface EditorialListResult {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedDate?: string;
  estimatedVenueCount?: number;
}

/**
 * SearXNGService
 *
 * Integration with self-hosted SearXNG metasearch engine.
 * Provides free, unlimited search across 70+ search engines.
 *
 * SearXNG aggregates results from:
 * - Google, Bing, DuckDuckGo
 * - News sources
 * - Image search
 * - Specialized engines
 *
 * @see https://github.com/searxng/searxng
 */
export class SearXNGService {
  private static instance: SearXNGService;
  private client: AxiosInstance;
  private baseUrl: string;

  private constructor() {
    this.baseUrl = process.env.SEARXNG_URL || 'http://localhost:8080';

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  static getInstance(): SearXNGService {
    if (!SearXNGService.instance) {
      SearXNGService.instance = new SearXNGService();
    }
    return SearXNGService.instance;
  }

  /**
   * Check if SearXNG is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.client.get('/healthz', { timeout: 5000 });
      return response.status === 200;
    } catch {
      // Try a simple search instead
      try {
        await this.search('test', { limit: 1 });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Raw search query to SearXNG
   */
  async search(
    query: string,
    options: {
      categories?: string[];
      engines?: string[];
      language?: string;
      timeRange?: 'day' | 'week' | 'month' | 'year';
      limit?: number;
    } = {}
  ): Promise<SearXNGResponse> {
    const { categories = ['general'], engines, language = 'en', timeRange, limit = 20 } = options;

    try {
      const params: Record<string, string> = {
        q: query,
        format: 'json',
        categories: categories.join(','),
        language,
      };

      if (engines) {
        params.engines = engines.join(',');
      }

      if (timeRange) {
        params.time_range = timeRange;
      }

      const response = await this.client.get('/search', { params });

      // Limit results
      const data = response.data as SearXNGResponse;
      if (data.results && data.results.length > limit) {
        data.results = data.results.slice(0, limit);
      }

      return data;
    } catch (error: any) {
      logger.error('SearXNG search error:', error.message);
      throw new Error(`SearXNG search failed: ${error.message}`);
    }
  }

  /**
   * Search for venues in a city
   */
  async searchVenues(
    venueName: string,
    cityName: string,
    options: {
      includeReviews?: boolean;
      includeNews?: boolean;
    } = {}
  ): Promise<VenueSearchResult[]> {
    const { includeReviews = true, includeNews = false } = options;

    const queries = [`"${venueName}" ${cityName} restaurant`];

    if (includeReviews) {
      queries.push(`"${venueName}" ${cityName} review`);
    }

    if (includeNews) {
      queries.push(`"${venueName}" ${cityName} opening news`);
    }

    const allResults: VenueSearchResult[] = [];

    for (const query of queries) {
      try {
        const response = await this.search(query, {
          categories: includeNews ? ['general', 'news'] : ['general'],
          limit: 10,
        });

        for (const result of response.results) {
          // Score based on relevance indicators
          let score = 0;
          const lowerTitle = result.title.toLowerCase();
          const lowerContent = result.content?.toLowerCase() || '';
          const lowerVenue = venueName.toLowerCase();

          if (lowerTitle.includes(lowerVenue)) score += 3;
          if (lowerContent.includes(lowerVenue)) score += 2;
          if (lowerTitle.includes('review')) score += 1;
          if (lowerTitle.includes('best')) score += 1;
          if (result.url.includes('yelp.com')) score += 1;
          if (result.url.includes('eater.com')) score += 2;
          if (result.url.includes('theinfatuation.com')) score += 2;
          if (result.url.includes('timeout.com')) score += 1;

          allResults.push({
            name: venueName,
            url: result.url,
            snippet: result.content || '',
            source: this.extractDomain(result.url),
            publishedDate: result.publishedDate,
            relevanceScore: score,
          });
        }

        // Rate limit between queries
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        logger.warn(`SearXNG query failed for "${query}":`, error);
      }
    }

    // Deduplicate by URL and sort by score
    const unique = new Map<string, VenueSearchResult>();
    for (const result of allResults) {
      const existing = unique.get(result.url);
      if (!existing || result.relevanceScore > existing.relevanceScore) {
        unique.set(result.url, result);
      }
    }

    return Array.from(unique.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Find "Best Of" editorial lists for a city
   */
  async findEditorialLists(
    cityName: string,
    options: {
      year?: number;
      category?: string;
    } = {}
  ): Promise<EditorialListResult[]> {
    const year = options.year || new Date().getFullYear();
    const category = options.category || 'restaurants';

    const queries = [
      `best ${category} ${cityName} ${year}`,
      `top ${category} ${cityName} list`,
      `"best of" ${cityName} ${category} ${year}`,
      `where to eat ${cityName} ${year}`,
      `essential ${category} ${cityName}`,
    ];

    const allResults: EditorialListResult[] = [];
    const seenUrls = new Set<string>();

    for (const query of queries) {
      try {
        const response = await this.search(query, {
          categories: ['general', 'news'],
          timeRange: 'year',
          limit: 15,
        });

        for (const result of response.results) {
          if (seenUrls.has(result.url)) continue;
          seenUrls.add(result.url);

          // Filter for editorial content
          const domain = this.extractDomain(result.url);
          const isEditorial = this.isEditorialSource(domain, result.title);

          if (!isEditorial) continue;

          // Estimate venue count from title/content
          const countMatch =
            result.title.match(/(\d+)\s+(best|top|essential)/i) ||
            result.content?.match(/(\d+)\s+(best|top|essential)/i);

          allResults.push({
            title: result.title,
            url: result.url,
            source: domain,
            snippet: result.content || '',
            publishedDate: result.publishedDate,
            estimatedVenueCount: countMatch ? parseInt(countMatch[1], 10) : undefined,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        logger.warn(`SearXNG query failed for "${query}":`, error);
      }
    }

    // Sort by editorial authority
    return allResults.sort((a, b) => {
      const scoreA = this.getEditorialScore(a.source);
      const scoreB = this.getEditorialScore(b.source);
      return scoreB - scoreA;
    });
  }

  /**
   * Search for new restaurant openings
   */
  async findNewOpenings(
    cityName: string,
    options: {
      timeRange?: 'week' | 'month';
      category?: string;
    } = {}
  ): Promise<EditorialListResult[]> {
    const { timeRange = 'month', category = 'restaurant' } = options;

    const queries = [
      `new ${category} opening ${cityName}`,
      `${category} just opened ${cityName}`,
      `coming soon ${category} ${cityName}`,
      `now open ${category} ${cityName}`,
    ];

    const allResults: EditorialListResult[] = [];
    const seenUrls = new Set<string>();

    for (const query of queries) {
      try {
        const response = await this.search(query, {
          categories: ['news', 'general'],
          timeRange,
          limit: 10,
        });

        for (const result of response.results) {
          if (seenUrls.has(result.url)) continue;
          seenUrls.add(result.url);

          allResults.push({
            title: result.title,
            url: result.url,
            source: this.extractDomain(result.url),
            snippet: result.content || '',
            publishedDate: result.publishedDate,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        logger.warn(`SearXNG query failed for "${query}":`, error);
      }
    }

    return allResults;
  }

  /**
   * Search for venue press mentions
   */
  async findPressMentions(
    venueName: string,
    cityName: string,
    options: {
      limit?: number;
    } = {}
  ): Promise<
    Array<{
      title: string;
      url: string;
      source: string;
      snippet: string;
      publishedDate?: string;
      mentionType: 'review' | 'feature' | 'list' | 'news';
    }>
  > {
    const { limit = 20 } = options;

    const response = await this.search(`"${venueName}" ${cityName}`, {
      categories: ['general', 'news'],
      limit: limit * 2,
    });

    const mentions: Array<{
      title: string;
      url: string;
      source: string;
      snippet: string;
      publishedDate?: string;
      mentionType: 'review' | 'feature' | 'list' | 'news';
    }> = [];

    for (const result of response.results) {
      const lowerTitle = result.title.toLowerCase();
      let mentionType: 'review' | 'feature' | 'list' | 'news' = 'news';

      if (lowerTitle.includes('review')) {
        mentionType = 'review';
      } else if (lowerTitle.includes('best') || lowerTitle.includes('top')) {
        mentionType = 'list';
      } else if (
        result.category === 'news' ||
        lowerTitle.includes('opens') ||
        lowerTitle.includes('opening')
      ) {
        mentionType = 'news';
      } else {
        mentionType = 'feature';
      }

      mentions.push({
        title: result.title,
        url: result.url,
        source: this.extractDomain(result.url),
        snippet: result.content || '',
        publishedDate: result.publishedDate,
        mentionType,
      });
    }

    return mentions.slice(0, limit);
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url;
    }
  }

  /**
   * Check if domain is an editorial source
   */
  private isEditorialSource(domain: string, title: string): boolean {
    const editorialDomains = [
      'eater.com',
      'theinfatuation.com',
      'thrillist.com',
      'timeout.com',
      'bonappetit.com',
      'foodandwine.com',
      'tastingtable.com',
      'nytimes.com',
      'washingtonpost.com',
      'sfchronicle.com',
      'latimes.com',
      'chicagomag.com',
      'phillymag.com',
      'bostonmagazine.com',
      'nymag.com',
      'grubstreet.com',
      'zagat.com',
    ];

    if (editorialDomains.some((ed) => domain.includes(ed))) {
      return true;
    }

    // Check title for list patterns
    const lowerTitle = title.toLowerCase();
    const listPatterns = [
      'best',
      'top',
      'essential',
      'guide to',
      'where to',
      'must-try',
      'favorite',
    ];

    return listPatterns.some((p) => lowerTitle.includes(p));
  }

  /**
   * Get editorial authority score
   */
  private getEditorialScore(domain: string): number {
    const scores: Record<string, number> = {
      'eater.com': 10,
      'theinfatuation.com': 10,
      'nytimes.com': 9,
      'bonappetit.com': 9,
      'foodandwine.com': 8,
      'timeout.com': 8,
      'thrillist.com': 7,
      'grubstreet.com': 7,
      'nymag.com': 7,
      'zagat.com': 6,
      'yelp.com': 4,
      'tripadvisor.com': 3,
    };

    for (const [site, score] of Object.entries(scores)) {
      if (domain.includes(site)) {
        return score;
      }
    }

    return 5; // Default score for unknown sources
  }
}

export default SearXNGService;
