import axios, { AxiosInstance } from 'axios';
import logger from './logger.service';

interface PerplexityMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface PerplexityResponse {
  id: string;
  model: string;
  created: number;
  choices: Array<{
    index: number;
    finish_reason: string;
    message: {
      role: string;
      content: string;
    };
    delta?: {
      role?: string;
      content?: string;
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  citations?: string[];
}

interface VenueDiscoveryResult {
  venues: Array<{
    name: string;
    description: string;
    address?: string;
    cuisine?: string;
    priceRange?: string;
    signatureDish?: string;
    vibe?: string;
    whyVisit?: string;
  }>;
  sources: string[];
  rawResponse: string;
}

interface VenueEnrichmentResult {
  description: string;
  signatureDishes: string[];
  vibe: string[];
  whyVisit: string;
  bestFor: string[];
  sources: string[];
}

/**
 * PerplexityAPIService
 *
 * Production Perplexity API integration for AI-powered venue discovery and enrichment.
 * Uses the official Perplexity API with real-time web search capabilities.
 *
 * @see https://docs.perplexity.ai/
 */
export class PerplexityAPIService {
  private static instance: PerplexityAPIService;
  private client: AxiosInstance;
  private apiKey: string;
  private model: string;

  private constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY || '';
    this.model = process.env.PERPLEXITY_MODEL || 'llama-3.1-sonar-small-128k-online';

    this.client = axios.create({
      baseURL: 'https://api.perplexity.ai',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60 second timeout for AI responses
    });
  }

  static getInstance(): PerplexityAPIService {
    if (!PerplexityAPIService.instance) {
      PerplexityAPIService.instance = new PerplexityAPIService();
    }
    return PerplexityAPIService.instance;
  }

  /**
   * Check if the service is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Raw chat completion with Perplexity
   */
  private async chatCompletion(
    messages: PerplexityMessage[],
    options: {
      temperature?: number;
      maxTokens?: number;
      returnCitations?: boolean;
    } = {}
  ): Promise<PerplexityResponse> {
    if (!this.isConfigured()) {
      throw new Error('Perplexity API key not configured. Set PERPLEXITY_API_KEY env variable.');
    }

    try {
      const response = await this.client.post('/chat/completions', {
        model: this.model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 2048,
        return_citations: options.returnCitations ?? true,
        stream: false,
      });

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 429) {
        logger.warn('Perplexity rate limit hit, waiting before retry...');
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return this.chatCompletion(messages, options);
      }
      logger.error('Perplexity API error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Discover venues in a city using AI search
   * Uses real-time web search to find the best restaurants, bars, etc.
   */
  async discoverVenues(
    cityName: string,
    options: {
      category?: string;
      limit?: number;
      focusOn?: 'new_openings' | 'hidden_gems' | 'best_of' | 'trending';
    } = {}
  ): Promise<VenueDiscoveryResult> {
    const { category = 'restaurants and bars', limit = 20, focusOn = 'best_of' } = options;

    const focusPrompts: Record<string, string> = {
      new_openings: `Find the newest ${category} that have opened in ${cityName} in 2024-2025. Focus on recent openings that are getting buzz.`,
      hidden_gems: `Find hidden gem ${category} in ${cityName} that locals love but aren't on the typical tourist radar. Focus on authentic, under-the-radar spots.`,
      best_of: `Find the absolute best ${category} in ${cityName} right now. Include a mix of established favorites and exciting newcomers.`,
      trending: `Find the most trending and talked-about ${category} in ${cityName} right now. What's getting buzz on social media and food blogs?`,
    };

    const systemPrompt = `You are a venue discovery expert. Your job is to find and describe the best venues in a city.

For each venue, extract:
- Name (exact name)
- Brief description (2-3 sentences)
- Address (if available)
- Cuisine type
- Price range ($, $$, $$$, or $$$$)
- Signature dish or drink
- Vibe/atmosphere
- Why someone should visit

Return your response as a valid JSON object with this exact structure:
{
  "venues": [
    {
      "name": "string",
      "description": "string",
      "address": "string or null",
      "cuisine": "string or null",
      "priceRange": "$ | $$ | $$$ | $$$$",
      "signatureDish": "string or null",
      "vibe": "string",
      "whyVisit": "string"
    }
  ]
}

Only include venues you are confident about. Quality over quantity.`;

    const userPrompt = `${focusPrompts[focusOn]}

Please find up to ${limit} venues and return them as JSON. Be specific about each venue's unique qualities.`;

    try {
      const response = await this.chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.3, returnCitations: true }
      );

      const content = response.choices[0]?.message?.content || '';

      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      let venues: VenueDiscoveryResult['venues'] = [];

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          venues = parsed.venues || [];
        } catch (parseError) {
          logger.warn('Failed to parse venue JSON, attempting extraction:', parseError);
          venues = this.extractVenuesFromText(content);
        }
      } else {
        venues = this.extractVenuesFromText(content);
      }

      return {
        venues,
        sources: response.citations || [],
        rawResponse: content,
      };
    } catch (error) {
      logger.error(`Failed to discover venues in ${cityName}:`, error);
      throw error;
    }
  }

  /**
   * Enrich a single venue with detailed information
   */
  async enrichVenue(
    venueName: string,
    cityName: string,
    existingData?: {
      address?: string;
      cuisine?: string;
      category?: string;
    }
  ): Promise<VenueEnrichmentResult> {
    const contextParts = [];
    if (existingData?.address) contextParts.push(`Address: ${existingData.address}`);
    if (existingData?.cuisine) contextParts.push(`Cuisine: ${existingData.cuisine}`);
    if (existingData?.category) contextParts.push(`Type: ${existingData.category}`);

    const context = contextParts.length > 0 ? `\nKnown info: ${contextParts.join(', ')}` : '';

    const systemPrompt = `You are a food and nightlife expert. Provide detailed, engaging information about venues.

Return your response as a valid JSON object:
{
  "description": "2-3 sentence compelling description",
  "signatureDishes": ["dish1", "dish2"],
  "vibe": ["vibe1", "vibe2"],
  "whyVisit": "One compelling sentence about why someone should visit",
  "bestFor": ["date night", "groups", "solo dining", etc.]
}`;

    const userPrompt = `Tell me about "${venueName}" in ${cityName}.${context}

What makes this place special? What should someone order? What's the vibe? Who is it best for?`;

    try {
      const response = await this.chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.3, returnCitations: true }
      );

      const content = response.choices[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            description: parsed.description || '',
            signatureDishes: parsed.signatureDishes || [],
            vibe: parsed.vibe || [],
            whyVisit: parsed.whyVisit || '',
            bestFor: parsed.bestFor || [],
            sources: response.citations || [],
          };
        } catch {
          // Fall through to default
        }
      }

      return {
        description: content.slice(0, 500),
        signatureDishes: [],
        vibe: [],
        whyVisit: '',
        bestFor: [],
        sources: response.citations || [],
      };
    } catch (error) {
      logger.error(`Failed to enrich venue ${venueName}:`, error);
      throw error;
    }
  }

  /**
   * Search for specific venue information (hours, menu, etc.)
   */
  async searchVenueInfo(
    venueName: string,
    cityName: string,
    infoType: 'hours' | 'menu' | 'reservations' | 'reviews'
  ): Promise<{ answer: string; sources: string[] }> {
    const prompts: Record<string, string> = {
      hours: `What are the current opening hours for "${venueName}" in ${cityName}? Include any special hours for holidays or weekends.`,
      menu: `What are the most popular menu items and their prices at "${venueName}" in ${cityName}?`,
      reservations: `How do I make a reservation at "${venueName}" in ${cityName}? Do they take reservations? Any tips?`,
      reviews: `What are people saying about "${venueName}" in ${cityName}? Summarize the general consensus from recent reviews.`,
    };

    try {
      const response = await this.chatCompletion(
        [
          {
            role: 'system',
            content:
              'You are a helpful assistant that provides accurate, up-to-date information about restaurants and bars. Be concise and factual.',
          },
          { role: 'user', content: prompts[infoType] },
        ],
        { temperature: 0.1, returnCitations: true }
      );

      return {
        answer: response.choices[0]?.message?.content || '',
        sources: response.citations || [],
      };
    } catch (error) {
      logger.error(`Failed to search venue info for ${venueName}:`, error);
      throw error;
    }
  }

  /**
   * Find "Best Of" lists for a city
   */
  async findBestOfLists(
    cityName: string,
    year: number = new Date().getFullYear()
  ): Promise<{
    lists: Array<{ title: string; source: string; url?: string; venueCount?: number }>;
    sources: string[];
  }> {
    const userPrompt = `Find the best "Best Of" restaurant and bar lists for ${cityName} from ${year}.
Include lists from sources like Eater, The Infatuation, Thrillist, TimeOut, local publications, and major food critics.
For each list, provide the title, source publication, and URL if available.`;

    try {
      const response = await this.chatCompletion(
        [
          {
            role: 'system',
            content: `You are a food media expert. Return results as JSON:
{
  "lists": [
    {"title": "string", "source": "string", "url": "string or null", "venueCount": number or null}
  ]
}`,
          },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.2, returnCitations: true }
      );

      const content = response.choices[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            lists: parsed.lists || [],
            sources: response.citations || [],
          };
        } catch {
          // Fall through
        }
      }

      return { lists: [], sources: response.citations || [] };
    } catch (error) {
      logger.error(`Failed to find best-of lists for ${cityName}:`, error);
      throw error;
    }
  }

  /**
   * Fallback extraction when JSON parsing fails
   */
  private extractVenuesFromText(text: string): Array<{
    name: string;
    description: string;
    address?: string;
    cuisine?: string;
    priceRange?: string;
    signatureDish?: string;
    vibe?: string;
    whyVisit?: string;
  }> {
    const venues: Array<{
      name: string;
      description: string;
      address?: string;
      cuisine?: string;
      priceRange?: string;
      signatureDish?: string;
      vibe?: string;
      whyVisit?: string;
    }> = [];

    // Simple pattern matching for numbered lists
    const lines = text.split('\n');
    let currentVenue: {
      name: string;
      description: string;
      address?: string;
      cuisine?: string;
      priceRange?: string;
      signatureDish?: string;
      vibe?: string;
      whyVisit?: string;
    } | null = null;

    for (const line of lines) {
      // Match patterns like "1. Restaurant Name" or "**Restaurant Name**"
      const nameMatch =
        line.match(/^\d+\.\s*\*{0,2}([^*\n]+)\*{0,2}/) || line.match(/^\*{2}([^*]+)\*{2}/);

      if (nameMatch) {
        if (currentVenue) {
          venues.push(currentVenue);
        }
        currentVenue = {
          name: nameMatch[1].trim(),
          description: '',
        };
      } else if (currentVenue && line.trim()) {
        currentVenue.description += line.trim() + ' ';
      }
    }

    if (currentVenue) {
      venues.push(currentVenue);
    }

    return venues.map((v) => ({
      ...v,
      description: v.description.trim().slice(0, 500),
    }));
  }
}

export default PerplexityAPIService;
