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
  businessStatus?: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';
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
  google_maps_url?: string;
}

export interface QualityFilters {
  minRating: number;
  minReviews: number;
  requirePhotos: boolean;
  requireContact: boolean;
  excludeClosed: boolean;
}

// Default quality thresholds for high-quality venues
export const DEFAULT_QUALITY_FILTERS: QualityFilters = {
  minRating: 4.2,
  minReviews: 100,
  requirePhotos: true,
  requireContact: true,
  excludeClosed: true,
};

// Relaxed filters for more coverage
export const RELAXED_QUALITY_FILTERS: QualityFilters = {
  minRating: 4.0,
  minReviews: 50,
  requirePhotos: true,
  requireContact: false,
  excludeClosed: true,
};

// City center coordinates for searches (all 15 MVP cities)
const CITY_INFO: Record<string, { lat: number; lng: number; name: string; state: string }> = {
  nyc: { lat: 40.7580, lng: -73.9855, name: 'New York City', state: 'NY' },
  la: { lat: 34.0522, lng: -118.2437, name: 'Los Angeles', state: 'CA' },
  chicago: { lat: 41.8827, lng: -87.6233, name: 'Chicago', state: 'IL' },
  sf: { lat: 37.7749, lng: -122.4194, name: 'San Francisco', state: 'CA' },
  houston: { lat: 29.7604, lng: -95.3698, name: 'Houston', state: 'TX' },
  miami: { lat: 25.7617, lng: -80.1918, name: 'Miami', state: 'FL' },
  austin: { lat: 30.2672, lng: -97.7431, name: 'Austin', state: 'TX' },
  vegas: { lat: 36.1147, lng: -115.1728, name: 'Las Vegas', state: 'NV' },
  philly: { lat: 39.9526, lng: -75.1652, name: 'Philadelphia', state: 'PA' },
  seattle: { lat: 47.6062, lng: -122.3321, name: 'Seattle', state: 'WA' },
  nola: { lat: 29.9511, lng: -90.0715, name: 'New Orleans', state: 'LA' },
  boston: { lat: 42.3601, lng: -71.0589, name: 'Boston', state: 'MA' },
  dc: { lat: 38.9072, lng: -77.0369, name: 'Washington DC', state: 'DC' },
  nashville: { lat: 36.1627, lng: -86.7816, name: 'Nashville', state: 'TN' },
  portland: { lat: 45.5152, lng: -122.6784, name: 'Portland', state: 'OR' },
};

// Neighborhoods for targeted searches (top areas per city - all 15 MVP cities)
const NEIGHBORHOODS: Record<string, string[]> = {
  nyc: [
    'Manhattan', 'Williamsburg Brooklyn', 'SoHo Manhattan', 'West Village Manhattan',
    'East Village Manhattan', 'Lower East Side Manhattan', 'Chelsea Manhattan',
    'Tribeca Manhattan', 'Nolita Manhattan', 'Greenpoint Brooklyn',
    'DUMBO Brooklyn', 'Park Slope Brooklyn', 'Bushwick Brooklyn', 'Astoria Queens',
    'Long Island City Queens', 'Harlem Manhattan', 'Upper West Side Manhattan',
  ],
  la: [
    'Silver Lake', 'Los Feliz', 'Echo Park', 'Highland Park', 'Venice Beach',
    'Santa Monica', 'West Hollywood', 'Downtown Los Angeles', 'Koreatown',
    'Arts District LA', 'Culver City', 'Pasadena', 'Beverly Hills', 'Malibu',
    'Manhattan Beach', 'Sawtelle', 'Little Tokyo',
  ],
  chicago: [
    'Wicker Park', 'Logan Square', 'Pilsen', 'West Loop', 'River North',
    'Lincoln Park', 'Bucktown', 'Hyde Park', 'Andersonville', 'Ukrainian Village',
    'Fulton Market', 'Gold Coast', 'Old Town', 'Lakeview', 'Wrigleyville',
  ],
  sf: [
    'Mission District', 'Hayes Valley', 'Marina District', 'North Beach', 'SOMA',
    'Castro', 'Noe Valley', 'Pacific Heights', 'Financial District', 'Chinatown SF',
    'Haight-Ashbury', 'Potrero Hill', 'Dogpatch', 'Inner Richmond', 'Japantown',
  ],
  houston: [
    'Montrose Houston', 'Heights Houston', 'Downtown Houston', 'Midtown Houston',
    'River Oaks', 'EaDo Houston', 'Museum District', 'Galleria', 'Upper Kirby',
    'Rice Village', 'Memorial Park', 'Westchase', 'Chinatown Houston', 'Bellaire',
  ],
  miami: [
    'Wynwood', 'Design District', 'South Beach', 'Brickell', 'Little Havana',
    'Coconut Grove', 'Coral Gables', 'Edgewater', 'Midtown Miami', 'Downtown Miami',
    'Little Haiti', 'North Beach', 'Key Biscayne', 'Miami Beach',
  ],
  austin: [
    'Downtown Austin', 'South Congress', 'East Austin', 'Rainey Street', 'Hyde Park Austin',
    'Zilker', 'Mueller', 'North Loop', 'Clarksville', 'Bouldin Creek',
    'West 6th Street', 'Domain Austin', 'South Lamar', 'Travis Heights',
  ],
  vegas: [
    'The Strip Las Vegas', 'Downtown Fremont Street', 'Arts District Las Vegas',
    'Summerlin', 'Henderson', 'Chinatown Las Vegas', 'Spring Valley',
    'Green Valley', 'Paradise', 'Enterprise',
  ],
  philly: [
    'Center City', 'Rittenhouse Square', 'Old City Philadelphia', 'Fishtown',
    'Northern Liberties', 'South Philly', 'University City', 'Manayunk',
    'East Passyunk', 'Queen Village', 'Fairmount', 'Chinatown Philadelphia',
  ],
  seattle: [
    'Capitol Hill Seattle', 'Ballard', 'Fremont Seattle', 'Queen Anne',
    'Pioneer Square', 'Pike Place', 'Georgetown Seattle', 'Columbia City',
    'Wallingford', 'University District', 'Beacon Hill Seattle', 'South Lake Union',
  ],
  nola: [
    'French Quarter', 'Garden District', 'Marigny', 'Bywater', 'Warehouse District',
    'Uptown New Orleans', 'Magazine Street', 'Mid-City New Orleans', 'Tremé',
    'Central Business District', 'Irish Channel', 'Frenchmen Street',
  ],
  boston: [
    'North End Boston', 'South End Boston', 'Back Bay', 'Beacon Hill', 'Seaport',
    'Cambridge', 'Somerville', 'Brookline', 'Jamaica Plain', 'Fenway',
    'Charlestown', 'South Boston', 'Allston Brighton',
  ],
  dc: [
    'Georgetown DC', 'Dupont Circle', 'Adams Morgan', 'U Street', 'Capitol Hill DC',
    'Shaw DC', 'Penn Quarter', 'Navy Yard', '14th Street NW', 'Logan Circle',
    'Columbia Heights', 'Petworth', 'H Street NE', 'Foggy Bottom',
  ],
  nashville: [
    'Downtown Nashville', 'East Nashville', 'The Gulch', 'Germantown Nashville',
    '12 South', 'Hillsboro Village', 'Midtown Nashville', 'Sylvan Park',
    'Marathon Village', 'West End Nashville', 'Music Row', 'Five Points Nashville',
  ],
  portland: [
    'Pearl District', 'Alberta Arts District', 'Hawthorne', 'Division Street Portland',
    'Mississippi Avenue', 'Northwest Portland', 'Southeast Portland', 'Sellwood',
    'St Johns', 'Montavilla', 'Hollywood Portland', 'Clinton Street',
  ],
};

// Tiered search queries for quality results
const SEARCH_TIERS = {
  // Tier 1: Award/Recognition-based (highest quality signal)
  tier1_awards: {
    restaurant: [
      'Michelin star restaurant',
      'Michelin Bib Gourmand restaurant',
      'James Beard award restaurant',
      'James Beard nominated restaurant',
      'best new restaurant 2024',
      'award winning restaurant',
    ],
    bar: [
      'best cocktail bar award',
      "World's 50 Best Bars",
      'James Beard award bar',
      'award winning speakeasy',
    ],
    cafe: [
      'best coffee roaster award',
      'specialty coffee award',
    ],
  },

  // Tier 2: Curated list references (editorial quality)
  tier2_curated: {
    restaurant: [
      'Eater 38 restaurant',
      'Eater best restaurants',
      'Infatuation best restaurant',
      'TimeOut best restaurant',
      'New York Times restaurant review',
      'best restaurant critics choice',
    ],
    bar: [
      'Eater best bars',
      'best speakeasy',
      'best rooftop bar',
      'best hotel bar',
      'hidden bar',
    ],
    cafe: [
      'best specialty coffee',
      'best coffee shop',
    ],
  },

  // Tier 3: Specific high-quality venue types
  tier3_types: {
    restaurant: [
      'fine dining restaurant',
      'tasting menu restaurant',
      'omakase restaurant',
      'farm to table restaurant',
      'intimate restaurant',
      'celebrity chef restaurant',
      'best Italian restaurant',
      'best Japanese restaurant',
      'best Mexican restaurant',
      'best French restaurant',
      'best steakhouse',
      'best seafood restaurant',
      'best brunch',
      'best date night restaurant',
    ],
    bar: [
      'craft cocktail bar',
      'speakeasy bar',
      'rooftop bar',
      'wine bar',
      'natural wine bar',
      'jazz bar',
      'whiskey bar',
      'mezcal bar',
      'tiki bar',
    ],
    cafe: [
      'specialty coffee roaster',
      'third wave coffee',
      'artisan bakery',
      'cafe with wifi',
    ],
  },
};

class GooglePlacesService {
  private static instance: GooglePlacesService;
  private apiKey: string;
  private baseUrl = 'https://places.googleapis.com/v1';
  private requestCount = 0;
  private lastRequestTime = 0;

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
   * Rate limiting - Google allows 600 QPM, we'll be conservative at 300 QPM
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 200; // 5 requests per second max

    if (timeSinceLastRequest < minInterval) {
      await this.delay(minInterval - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Search for places using text query (Places API New)
   */
  async textSearch(query: string, options: {
    location?: { lat: number; lng: number };
    radius?: number;
    maxResults?: number;
  } = {}): Promise<GooglePlace[]> {
    if (!this.apiKey) {
      throw new Error('Google Maps API key not configured');
    }

    await this.rateLimit();

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
      'places.businessStatus',
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
          radius: options.radius || 15000, // 15km default
        },
      };
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

      const data = await response.json() as PlaceSearchResponse;
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
   * Check if a place meets quality thresholds
   */
  meetsQualityThreshold(place: GooglePlace, filters: QualityFilters): boolean {
    // Check rating
    if (!place.rating || place.rating < filters.minRating) {
      return false;
    }

    // Check review count
    if (!place.userRatingCount || place.userRatingCount < filters.minReviews) {
      return false;
    }

    // Check photos
    if (filters.requirePhotos && (!place.photos || place.photos.length === 0)) {
      return false;
    }

    // Check contact info
    if (filters.requireContact && !place.websiteUri && !place.nationalPhoneNumber) {
      return false;
    }

    // Check business status
    if (filters.excludeClosed && place.businessStatus === 'CLOSED_PERMANENTLY') {
      return false;
    }

    return true;
  }

  /**
   * Convert Google Place to our venue format
   */
  convertToVenue(place: GooglePlace, cityId: string, neighborhood?: string): VenueFromGoogle {
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
      neighborhood,
      google_maps_url: place.googleMapsUri,
    };
  }

  /**
   * Discover high-quality venues using tiered search strategy
   */
  async discoverQualityVenues(
    cityId: string,
    options: {
      category?: 'restaurant' | 'bar' | 'cafe';
      targetCount?: number;
      qualityFilters?: QualityFilters;
      includeTier1?: boolean;
      includeTier2?: boolean;
      includeTier3?: boolean;
      includeNeighborhoods?: boolean;
      onProgress?: (msg: string) => void;
    } = {}
  ): Promise<VenueFromGoogle[]> {
    const cityInfo = CITY_INFO[cityId];
    if (!cityInfo) {
      throw new Error(`Unknown city: ${cityId}`);
    }

    const category = options.category || 'restaurant';
    const targetCount = options.targetCount || 200;
    const filters = options.qualityFilters || DEFAULT_QUALITY_FILTERS;
    const allVenues: VenueFromGoogle[] = [];
    const seenPlaceIds = new Set<string>();
    const log = options.onProgress || ((msg: string) => logger.info(msg));

    const addVenues = (places: GooglePlace[], neighborhood?: string) => {
      for (const place of places) {
        if (seenPlaceIds.has(place.id)) continue;
        if (!this.meetsQualityThreshold(place, filters)) continue;

        seenPlaceIds.add(place.id);
        allVenues.push(this.convertToVenue(place, cityId, neighborhood));
      }
    };

    // Tier 1: Award-based searches (highest quality)
    if (options.includeTier1 !== false) {
      const tier1Queries = SEARCH_TIERS.tier1_awards[category] || [];
      log(`\n📍 Tier 1: Award-based searches (${tier1Queries.length} queries)`);

      for (const query of tier1Queries) {
        const fullQuery = `${query} ${cityInfo.name}`;
        log(`  🔍 "${fullQuery}"`);

        try {
          const places = await this.textSearch(fullQuery, {
            location: cityInfo,
            radius: 25000,
          });
          const before = allVenues.length;
          addVenues(places);
          log(`     Found ${places.length}, kept ${allVenues.length - before} (total: ${allVenues.length})`);
        } catch (error) {
          log(`     ⚠️ Error: ${error}`);
        }

        if (allVenues.length >= targetCount) break;
      }
    }

    // Tier 2: Curated list searches
    if (options.includeTier2 !== false && allVenues.length < targetCount) {
      const tier2Queries = SEARCH_TIERS.tier2_curated[category] || [];
      log(`\n📍 Tier 2: Curated list searches (${tier2Queries.length} queries)`);

      for (const query of tier2Queries) {
        const fullQuery = `${query} ${cityInfo.name}`;
        log(`  🔍 "${fullQuery}"`);

        try {
          const places = await this.textSearch(fullQuery, {
            location: cityInfo,
            radius: 25000,
          });
          const before = allVenues.length;
          addVenues(places);
          log(`     Found ${places.length}, kept ${allVenues.length - before} (total: ${allVenues.length})`);
        } catch (error) {
          log(`     ⚠️ Error: ${error}`);
        }

        if (allVenues.length >= targetCount) break;
      }
    }

    // Tier 3: Specific venue type searches
    if (options.includeTier3 !== false && allVenues.length < targetCount) {
      const tier3Queries = SEARCH_TIERS.tier3_types[category] || [];
      log(`\n📍 Tier 3: Venue type searches (${tier3Queries.length} queries)`);

      for (const query of tier3Queries) {
        const fullQuery = `${query} ${cityInfo.name}`;
        log(`  🔍 "${fullQuery}"`);

        try {
          const places = await this.textSearch(fullQuery, {
            location: cityInfo,
            radius: 25000,
          });
          const before = allVenues.length;
          addVenues(places);
          log(`     Found ${places.length}, kept ${allVenues.length - before} (total: ${allVenues.length})`);
        } catch (error) {
          log(`     ⚠️ Error: ${error}`);
        }

        if (allVenues.length >= targetCount) break;
      }
    }

    // Tier 4: Neighborhood-based searches for coverage
    if (options.includeNeighborhoods !== false && allVenues.length < targetCount) {
      const neighborhoods = NEIGHBORHOODS[cityId] || [];
      log(`\n📍 Tier 4: Neighborhood searches (${neighborhoods.length} neighborhoods)`);

      for (const hood of neighborhoods) {
        const query = `best ${category} ${hood}`;
        log(`  🔍 "${query}"`);

        try {
          const places = await this.textSearch(query, {
            location: cityInfo,
            radius: 30000,
          });
          const before = allVenues.length;
          addVenues(places, hood);
          log(`     Found ${places.length}, kept ${allVenues.length - before} (total: ${allVenues.length})`);
        } catch (error) {
          log(`     ⚠️ Error: ${error}`);
        }

        if (allVenues.length >= targetCount) break;
      }
    }

    log(`\n✅ Discovered ${allVenues.length} quality venues in ${cityInfo.name}`);
    log(`   Quality threshold: ≥${filters.minRating}⭐, ≥${filters.minReviews} reviews`);

    return allVenues.slice(0, targetCount);
  }

  /**
   * Get statistics about API usage
   */
  getStats(): { requestCount: number } {
    return { requestCount: this.requestCount };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const googlePlacesService = GooglePlacesService.getInstance();
export default googlePlacesService;
