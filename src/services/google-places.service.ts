/**
 * Google Places API Service
 * 
 * Uses Google Maps Places API (New) for venue discovery and enrichment
 * Docs: https://developers.google.com/maps/documentation/places/web-service
 * 
 * Required env: GOOGLE_MAPS_API_KEY
 */

import logger from './logger.service';

// Places API (New) types
interface PlaceSearchResponse {
  places: GooglePlace[];
  nextPageToken?: string;
}

interface GooglePlace {
  id: string;
  displayName: { text: string; languageCode: string };
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  types: string[];
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: 'PRICE_LEVEL_FREE' | 'PRICE_LEVEL_INEXPENSIVE' | 'PRICE_LEVEL_MODERATE' | 'PRICE_LEVEL_EXPENSIVE' | 'PRICE_LEVEL_VERY_EXPENSIVE';
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  regularOpeningHours?: {
    weekdayDescriptions: string[];
    openNow?: boolean;
  };
  photos?: Array<{
    name: string;
    widthPx: number;
    heightPx: number;
  }>;
  editorialSummary?: { text: string };
  reviews?: Array<{
    rating: number;
    text: { text: string };
    authorAttribution: { displayName: string };
    publishTime: string;
  }>;
  googleMapsUri?: string;
}

export interface VenueFromGoogle {
  name: string;
  address: string;
  city_id: string;
  category: string;
  cuisine?: string;
  price_range: string;
  description?: string;
  website?: string;
  phone?: string;
  image_url?: string;
  rating?: number;
  review_count?: number;
  coordinates: { lat: number; lng: number };
  features: string[];
  source: string;
  google_place_id: string;
  opening_hours?: string[];
  neighborhood?: string;
}

// City center coordinates for searches
const CITY_CENTERS: Record<string, { lat: number; lng: number; name: string }> = {
  nyc: { lat: 40.7580, lng: -73.9855, name: 'New York City' },
  la: { lat: 34.0522, lng: -118.2437, name: 'Los Angeles' },
  chicago: { lat: 41.8827, lng: -87.6233, name: 'Chicago' },
  miami: { lat: 25.7617, lng: -80.1918, name: 'Miami' },
  vegas: { lat: 36.1147, lng: -115.1728, name: 'Las Vegas' },
};

// Neighborhoods for more targeted searches
const NEIGHBORHOODS: Record<string, string[]> = {
  nyc: [
    'Manhattan', 'Williamsburg', 'SoHo', 'West Village', 'East Village',
    'Lower East Side', 'Chelsea', 'Tribeca', 'Nolita', 'Greenpoint',
    'DUMBO Brooklyn', 'Park Slope', 'Bushwick', 'Astoria Queens',
  ],
  la: [
    'Silver Lake', 'Los Feliz', 'Echo Park', 'Highland Park', 'Venice',
    'Santa Monica', 'West Hollywood', 'Downtown LA', 'Koreatown', 'Arts District',
    'Culver City', 'Pasadena', 'Beverly Hills',
  ],
  chicago: [
    'Wicker Park', 'Logan Square', 'Pilsen', 'West Loop', 'River North',
    'Lincoln Park', 'Bucktown', 'Hyde Park', 'Andersonville', 'Ukrainian Village',
  ],
  miami: [
    'Wynwood', 'Design District', 'South Beach', 'Brickell', 'Little Havana',
    'Coconut Grove', 'Coral Gables', 'Edgewater', 'Midtown', 'Downtown Miami',
  ],
  vegas: [
    'The Strip', 'Downtown Fremont', 'Arts District', 'Summerlin', 'Henderson',
    'Chinatown', 'Spring Valley',
  ],
};

// Search queries for different venue types
const SEARCH_QUERIES = {
  restaurant: [
    'best restaurants',
    'fine dining restaurant',
    'trendy new restaurant',
    'hidden gem restaurant',
    'best italian restaurant',
    'best mexican restaurant',
    'best asian restaurant',
    'farm to table restaurant',
    'romantic dinner restaurant',
    'best brunch restaurant',
  ],
  bar: [
    'best cocktail bar',
    'speakeasy bar',
    'rooftop bar',
    'wine bar',
    'craft beer bar',
    'jazz bar',
    'dive bar',
    'hotel bar',
  ],
  cafe: [
    'specialty coffee shop',
    'best coffee roaster',
    'cafe with wifi',
    'artisan bakery cafe',
  ],
};

class GooglePlacesService {
  private static instance: GooglePlacesService;
  private apiKey: string;
  private baseUrl = 'https://places.googleapis.com/v1';

  private constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('GOOGLE_MAPS_API_KEY not set - Google Places API unavailable');
    }
  }

  static getInstance(): GooglePlacesService {
    if (!GooglePlacesService.instance) {
      GooglePlacesService.instance = new GooglePlacesService();
    }
    return GooglePlacesService.instance;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Search for places using text query (Places API New)
   */
  async textSearch(query: string, options: {
    location?: { lat: number; lng: number };
    radius?: number;
    type?: string;
    maxResults?: number;
  } = {}): Promise<GooglePlace[]> {
    if (!this.apiKey) {
      throw new Error('Google Maps API key not configured');
    }

    const fieldMask = [
      'places.id',
      'places.displayName',
      'places.formattedAddress',
      'places.location',
      'places.types',
      'places.primaryType',
      'places.rating',
      'places.userRatingCount',
      'places.priceLevel',
      'places.websiteUri',
      'places.nationalPhoneNumber',
      'places.regularOpeningHours',
      'places.photos',
      'places.editorialSummary',
      'places.googleMapsUri',
    ].join(',');

    const body: Record<string, unknown> = {
      textQuery: query,
      maxResultCount: options.maxResults || 20,
      languageCode: 'en',
    };

    if (options.location) {
      body.locationBias = {
        circle: {
          center: {
            latitude: options.location.lat,
            longitude: options.location.lng,
          },
          radius: options.radius || 10000, // 10km default
        },
      };
    }

    if (options.type) {
      body.includedType = options.type;
    }

    try {
      const response = await fetch(`${this.baseUrl}/places:searchText`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error(`Google Places API error: ${response.status} - ${error}`);
        throw new Error(`Google Places API error: ${response.status}`);
      }

      const data: PlaceSearchResponse = await response.json();
      return data.places || [];
    } catch (error) {
      logger.error('Google Places search failed:', error);
      throw error;
    }
  }

  /**
   * Get photo URL for a place photo reference
   */
  getPhotoUrl(photoName: string, maxWidth = 800): string {
    return `${this.baseUrl}/${photoName}/media?maxWidthPx=${maxWidth}&key=${this.apiKey}`;
  }

  /**
   * Convert Google Place to our venue format
   */
  convertToVenue(place: GooglePlace, cityId: string): VenueFromGoogle {
    const priceMap: Record<string, string> = {
      'PRICE_LEVEL_FREE': 'free',
      'PRICE_LEVEL_INEXPENSIVE': '$',
      'PRICE_LEVEL_MODERATE': '$$',
      'PRICE_LEVEL_EXPENSIVE': '$$$',
      'PRICE_LEVEL_VERY_EXPENSIVE': '$$$$',
    };

    // Determine category from types
    let category = 'restaurant';
    const types = place.types || [];
    if (types.includes('bar') || types.includes('night_club')) {
      category = 'bar';
    } else if (types.includes('cafe') || types.includes('coffee_shop')) {
      category = 'cafe';
    }

    // Extract cuisine from types
    const cuisineTypes = types.filter(t => 
      t.includes('restaurant') && t !== 'restaurant'
    );
    const cuisine = cuisineTypes.length > 0 
      ? cuisineTypes[0].replace('_restaurant', '').replace(/_/g, ' ')
      : undefined;

    // Get first photo URL
    const imageUrl = place.photos?.[0]
      ? this.getPhotoUrl(place.photos[0].name)
      : undefined;

    return {
      name: place.displayName.text,
      address: place.formattedAddress,
      city_id: cityId,
      category,
      cuisine,
      price_range: priceMap[place.priceLevel || ''] || '$$',
      description: place.editorialSummary?.text,
      website: place.websiteUri,
      phone: place.nationalPhoneNumber,
      image_url: imageUrl,
      rating: place.rating,
      review_count: place.userRatingCount,
      coordinates: {
        lat: place.location.latitude,
        lng: place.location.longitude,
      },
      features: types.filter(t => !t.includes('establishment')),
      source: 'google_places',
      google_place_id: place.id,
      opening_hours: place.regularOpeningHours?.weekdayDescriptions,
    };
  }

  /**
   * Discover venues in a city
   */
  async discoverVenuesInCity(
    cityId: string,
    options: {
      category?: 'restaurant' | 'bar' | 'cafe';
      limit?: number;
      includeNeighborhoods?: boolean;
    } = {}
  ): Promise<VenueFromGoogle[]> {
    const cityInfo = CITY_CENTERS[cityId];
    if (!cityInfo) {
      throw new Error(`Unknown city: ${cityId}`);
    }

    const category = options.category || 'restaurant';
    const queries = SEARCH_QUERIES[category] || SEARCH_QUERIES.restaurant;
    const allVenues: VenueFromGoogle[] = [];
    const seenPlaceIds = new Set<string>();

    // Search using main city queries
    for (const query of queries) {
      const fullQuery = `${query} ${cityInfo.name}`;
      logger.info(`Searching: ${fullQuery}`);

      try {
        const places = await this.textSearch(fullQuery, {
          location: cityInfo,
          radius: 15000, // 15km
          maxResults: 20,
        });

        for (const place of places) {
          if (!seenPlaceIds.has(place.id)) {
            seenPlaceIds.add(place.id);
            allVenues.push(this.convertToVenue(place, cityId));
          }
        }

        // Rate limit - Google allows 600 QPM but be conservative
        await this.delay(200);
      } catch (error) {
        logger.warn(`Search failed for "${fullQuery}": ${error}`);
      }

      if (options.limit && allVenues.length >= options.limit) {
        break;
      }
    }

    // Optionally search by neighborhood
    if (options.includeNeighborhoods && allVenues.length < (options.limit || 500)) {
      const neighborhoods = NEIGHBORHOODS[cityId] || [];
      
      for (const hood of neighborhoods.slice(0, 5)) {
        const query = `best ${category} ${hood} ${cityInfo.name}`;
        logger.info(`Searching neighborhood: ${query}`);

        try {
          const places = await this.textSearch(query, {
            location: cityInfo,
            radius: 20000,
            maxResults: 10,
          });

          for (const place of places) {
            if (!seenPlaceIds.has(place.id)) {
              seenPlaceIds.add(place.id);
              const venue = this.convertToVenue(place, cityId);
              venue.neighborhood = hood;
              allVenues.push(venue);
            }
          }

          await this.delay(200);
        } catch (error) {
          logger.warn(`Neighborhood search failed: ${error}`);
        }

        if (options.limit && allVenues.length >= options.limit) {
          break;
        }
      }
    }

    logger.info(`Discovered ${allVenues.length} unique venues in ${cityInfo.name}`);
    return allVenues.slice(0, options.limit);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const googlePlacesService = GooglePlacesService.getInstance();
export default googlePlacesService;

