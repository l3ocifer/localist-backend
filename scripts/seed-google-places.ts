#!/usr/bin/env ts-node
/**
 * 🗺️ UNIFIED VENUE SCRAPER
 * 
 * The single source of truth for scraping venue data from Google Places API.
 * Supports all 15 MVP cities with 4.0+ star quality filter.
 * 
 * Usage:
 *   npx ts-node scripts/seed-google-places.ts                    # All cities
 *   npx ts-node scripts/seed-google-places.ts --city sf          # Single city
 *   npx ts-node scripts/seed-google-places.ts --cities sf,austin # Multiple cities
 *   npx ts-node scripts/seed-google-places.ts --phase 2          # Phase 2 cities
 *   npx ts-node scripts/seed-google-places.ts --dry-run          # Preview mode
 *   npx ts-node scripts/seed-google-places.ts --min-rating 4.5   # Custom rating
 *   npx ts-node scripts/seed-google-places.ts --target 150       # Venues per city
 * 
 * Environment:
 *   GOOGLE_MAPS_API_KEY - Required
 *   DATABASE_URL - PostgreSQL connection string
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env.local'), override: true });
dotenv.config({ path: path.join(__dirname, '../.env'), override: true });

import pool from '../src/config/database';

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_BASE_URL = 'https://places.googleapis.com/v1';

// Default quality thresholds (can be overridden via CLI)
const DEFAULT_MIN_RATING = 4.0;
const DEFAULT_MIN_REVIEWS = 50;
const DEFAULT_TARGET_PER_CITY = 100;

// ============================================================================
// CITY DEFINITIONS - All 15 MVP Cities
// ============================================================================

interface City {
  id: string;
  name: string;
  state: string;
  phase: number;
  lat: number;
  lng: number;
  neighborhoods: string[];
}

const CITIES: City[] = [
  // Phase 1 - Launch cities
  {
    id: 'nyc', name: 'New York City', state: 'NY', phase: 1,
    lat: 40.7580, lng: -73.9855,
    neighborhoods: [
      'Manhattan', 'Williamsburg Brooklyn', 'SoHo Manhattan', 'West Village',
      'East Village', 'Chelsea Manhattan', 'Tribeca', 'DUMBO Brooklyn',
      'Greenpoint Brooklyn', 'Park Slope Brooklyn', 'Bushwick Brooklyn',
      'Astoria Queens', 'Long Island City', 'Harlem', 'Upper West Side',
    ],
  },
  {
    id: 'la', name: 'Los Angeles', state: 'CA', phase: 1,
    lat: 34.0522, lng: -118.2437,
    neighborhoods: [
      'Silver Lake', 'Los Feliz', 'Echo Park', 'Highland Park', 'Venice Beach',
      'Santa Monica', 'West Hollywood', 'Downtown LA', 'Koreatown',
      'Arts District LA', 'Culver City', 'Pasadena', 'Beverly Hills',
      'Manhattan Beach', 'Sawtelle', 'Little Tokyo',
    ],
  },
  {
    id: 'chicago', name: 'Chicago', state: 'IL', phase: 1,
    lat: 41.8827, lng: -87.6233,
    neighborhoods: [
      'Wicker Park', 'Logan Square', 'Pilsen', 'West Loop', 'River North',
      'Lincoln Park', 'Bucktown', 'Hyde Park', 'Andersonville', 'Ukrainian Village',
      'Fulton Market', 'Gold Coast', 'Old Town', 'Lakeview', 'Wrigleyville',
    ],
  },
  {
    id: 'sf', name: 'San Francisco', state: 'CA', phase: 1,
    lat: 37.7749, lng: -122.4194,
    neighborhoods: [
      'Mission District', 'Hayes Valley', 'Marina District', 'North Beach', 'SOMA',
      'Castro', 'Noe Valley', 'Pacific Heights', 'Financial District', 'Chinatown SF',
      'Haight-Ashbury', 'Potrero Hill', 'Dogpatch', 'Inner Richmond', 'Japantown',
    ],
  },
  {
    id: 'miami', name: 'Miami', state: 'FL', phase: 1,
    lat: 25.7617, lng: -80.1918,
    neighborhoods: [
      'Wynwood', 'Design District', 'South Beach', 'Brickell', 'Little Havana',
      'Coconut Grove', 'Coral Gables', 'Edgewater', 'Midtown Miami', 'Downtown Miami',
      'Little Haiti', 'North Beach', 'Key Biscayne', 'Miami Beach',
    ],
  },
  // Phase 2 - Week 2 cities
  {
    id: 'houston', name: 'Houston', state: 'TX', phase: 2,
    lat: 29.7604, lng: -95.3698,
    neighborhoods: [
      'Montrose Houston', 'Heights Houston', 'Downtown Houston', 'Midtown Houston',
      'River Oaks', 'EaDo Houston', 'Museum District', 'Galleria', 'Upper Kirby',
      'Rice Village', 'Memorial Park', 'Westchase', 'Chinatown Houston', 'Bellaire',
    ],
  },
  {
    id: 'austin', name: 'Austin', state: 'TX', phase: 2,
    lat: 30.2672, lng: -97.7431,
    neighborhoods: [
      'Downtown Austin', 'South Congress', 'East Austin', 'Rainey Street', 'Hyde Park',
      'Zilker', 'Mueller', 'North Loop', 'Clarksville', 'Bouldin Creek',
      'West 6th Street', 'Domain Austin', 'South Lamar', 'Travis Heights',
    ],
  },
  {
    id: 'vegas', name: 'Las Vegas', state: 'NV', phase: 2,
    lat: 36.1147, lng: -115.1728,
    neighborhoods: [
      'The Strip Las Vegas', 'Downtown Fremont Street', 'Arts District Las Vegas',
      'Summerlin', 'Henderson', 'Chinatown Las Vegas', 'Spring Valley',
      'Green Valley', 'Paradise', 'Enterprise',
    ],
  },
  {
    id: 'philly', name: 'Philadelphia', state: 'PA', phase: 2,
    lat: 39.9526, lng: -75.1652,
    neighborhoods: [
      'Center City', 'Rittenhouse Square', 'Old City Philadelphia', 'Fishtown',
      'Northern Liberties', 'South Philly', 'University City', 'Manayunk',
      'East Passyunk', 'Queen Village', 'Fairmount', 'Chinatown Philadelphia',
    ],
  },
  {
    id: 'seattle', name: 'Seattle', state: 'WA', phase: 2,
    lat: 47.6062, lng: -122.3321,
    neighborhoods: [
      'Capitol Hill Seattle', 'Ballard', 'Fremont Seattle', 'Queen Anne',
      'Pioneer Square', 'Pike Place', 'Georgetown Seattle', 'Columbia City',
      'Wallingford', 'University District', 'Beacon Hill Seattle', 'South Lake Union',
    ],
  },
  // Phase 3 - Week 3 cities
  {
    id: 'nola', name: 'New Orleans', state: 'LA', phase: 3,
    lat: 29.9511, lng: -90.0715,
    neighborhoods: [
      'French Quarter', 'Garden District', 'Marigny', 'Bywater', 'Warehouse District',
      'Uptown New Orleans', 'Magazine Street', 'Mid-City New Orleans', 'Tremé',
      'Central Business District', 'Irish Channel', 'Frenchmen Street',
    ],
  },
  {
    id: 'boston', name: 'Boston', state: 'MA', phase: 3,
    lat: 42.3601, lng: -71.0589,
    neighborhoods: [
      'North End Boston', 'South End Boston', 'Back Bay', 'Beacon Hill', 'Seaport',
      'Cambridge', 'Somerville', 'Brookline', 'Jamaica Plain', 'Fenway',
      'Charlestown', 'South Boston', 'Allston Brighton',
    ],
  },
  {
    id: 'dc', name: 'Washington DC', state: 'DC', phase: 3,
    lat: 38.9072, lng: -77.0369,
    neighborhoods: [
      'Georgetown DC', 'Dupont Circle', 'Adams Morgan', 'U Street', 'Capitol Hill DC',
      'Shaw DC', 'Penn Quarter', 'Navy Yard', '14th Street NW', 'Logan Circle',
      'Columbia Heights', 'Petworth', 'H Street NE', 'Foggy Bottom',
    ],
  },
  {
    id: 'nashville', name: 'Nashville', state: 'TN', phase: 3,
    lat: 36.1627, lng: -86.7816,
    neighborhoods: [
      'Downtown Nashville', 'East Nashville', 'The Gulch', 'Germantown Nashville',
      '12 South', 'Hillsboro Village', 'Midtown Nashville', 'Sylvan Park',
      'Marathon Village', 'West End Nashville', 'Music Row', 'Five Points Nashville',
    ],
  },
  {
    id: 'portland', name: 'Portland', state: 'OR', phase: 3,
    lat: 45.5152, lng: -122.6784,
    neighborhoods: [
      'Pearl District', 'Alberta Arts District', 'Hawthorne', 'Division Street Portland',
      'Mississippi Avenue', 'Northwest Portland', 'Southeast Portland', 'Sellwood',
      'St Johns', 'Montavilla', 'Hollywood Portland', 'Clinton Street',
    ],
  },
];

// ============================================================================
// SEARCH QUERIES - Tiered for quality
// ============================================================================

const SEARCH_QUERIES = {
  // Tier 1: Award/Recognition-based (highest quality signal)
  tier1: {
    restaurant: [
      'Michelin star restaurant', 'James Beard award restaurant', 'best new restaurant 2024',
      'award winning restaurant', 'Michelin Bib Gourmand restaurant',
    ],
    bar: [
      'best cocktail bar award', "World's 50 Best Bars", 'award winning speakeasy',
      'James Beard award bar',
    ],
    cafe: ['best coffee roaster award', 'specialty coffee award'],
  },
  // Tier 2: Curated list references (editorial quality)
  tier2: {
    restaurant: [
      'Eater 38 restaurant', 'Infatuation best restaurant', 'TimeOut best restaurant',
      'New York Times restaurant review', 'best restaurant critics choice',
    ],
    bar: ['Eater best bars', 'best speakeasy', 'best rooftop bar', 'best hotel bar'],
    cafe: ['best specialty coffee', 'best coffee shop'],
  },
  // Tier 3: Cuisine and type specific
  tier3: {
    restaurant: [
      'fine dining', 'tasting menu', 'omakase', 'farm to table',
      'best Italian restaurant', 'best Japanese restaurant', 'best Mexican restaurant',
      'best Chinese restaurant', 'best Thai restaurant', 'best Indian restaurant',
      'best French restaurant', 'best steakhouse', 'best seafood restaurant',
      'best brunch', 'best date night restaurant', 'best pizza',
      'best sushi', 'best ramen', 'best tacos', 'best burger',
    ],
    bar: [
      'craft cocktail bar', 'speakeasy bar', 'rooftop bar', 'wine bar',
      'natural wine bar', 'jazz bar', 'whiskey bar', 'mezcal bar', 'tiki bar',
    ],
    cafe: ['specialty coffee roaster', 'third wave coffee', 'artisan bakery cafe'],
  },
};

const CATEGORIES = ['restaurant', 'bar', 'cafe'] as const;
type Category = typeof CATEGORIES[number];

// ============================================================================
// GOOGLE PLACES API
// ============================================================================

interface GooglePlace {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  types: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: { weekdayDescriptions: string[] };
  photos?: Array<{ name: string }>;
  editorialSummary?: { text: string };
  googleMapsUri?: string;
  businessStatus?: string;
}

let requestCount = 0;
let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const minInterval = 200; // 5 requests/second
  if (now - lastRequestTime < minInterval) {
    await delay(minInterval - (now - lastRequestTime));
  }
  lastRequestTime = Date.now();
  requestCount++;
}

async function textSearch(query: string, location: { lat: number; lng: number }): Promise<GooglePlace[]> {
  if (!API_KEY) throw new Error('GOOGLE_MAPS_API_KEY not set');

  await rateLimit();

  const fieldMask = [
    'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
    'places.types', 'places.rating', 'places.userRatingCount', 'places.priceLevel',
    'places.websiteUri', 'places.nationalPhoneNumber', 'places.regularOpeningHours',
    'places.photos', 'places.editorialSummary', 'places.googleMapsUri', 'places.businessStatus',
  ].join(',');

  const response = await fetch(`${PLACES_BASE_URL}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 20,
      languageCode: 'en',
      locationBias: {
        circle: { center: { latitude: location.lat, longitude: location.lng }, radius: 25000 },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }

  const data = await response.json() as { places?: GooglePlace[] };
  return data.places || [];
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// VENUE SCRAPER CLASS
// ============================================================================

interface ScraperOptions {
  dryRun: boolean;
  jsonOutput: boolean;  // Output to JSON files instead of DB
  minRating: number;
  minReviews: number;
  targetPerCity: number;
  cities?: string[];
  phase?: number;
}

class VenueScraper {
  private options: ScraperOptions;
  private stats = {
    total: 0,
    saved: 0,
    duplicates: 0,
    lowQuality: 0,
  };
  private venuesByCity: Map<string, any[]> = new Map();
  private seenPlaceIds: Set<string> = new Set();

  constructor(options: ScraperOptions) {
    this.options = options;
  }

  async run(): Promise<void> {
    console.log('\n' + '═'.repeat(70));
    console.log('🗺️  LOCALIST VENUE SCRAPER');
    console.log('═'.repeat(70));
    console.log(`Mode:        ${this.options.dryRun ? '🔍 DRY RUN' : this.options.jsonOutput ? '📄 JSON OUTPUT' : '💾 DATABASE'}`);
    console.log(`Min Rating:  ${this.options.minRating}⭐`);
    console.log(`Min Reviews: ${this.options.minReviews}`);
    console.log(`Target:      ${this.options.targetPerCity} venues/city`);
    console.log('═'.repeat(70));

    if (!API_KEY) {
      console.error('\n❌ GOOGLE_MAPS_API_KEY not set');
      process.exit(1);
    }

    // Determine which cities to process
    let citiesToProcess = CITIES;
    
    if (this.options.cities && this.options.cities.length > 0) {
      citiesToProcess = CITIES.filter(c => this.options.cities!.includes(c.id));
    } else if (this.options.phase) {
      citiesToProcess = CITIES.filter(c => c.phase === this.options.phase);
    }

    if (citiesToProcess.length === 0) {
      console.error('\n❌ No cities matched criteria');
      this.printHelp();
      process.exit(1);
    }

    console.log(`\nCities (${citiesToProcess.length}):`);
    citiesToProcess.forEach(c => console.log(`  • ${c.name}, ${c.state} (Phase ${c.phase})`));

    // Process each city
    for (const city of citiesToProcess) {
      await this.processCity(city);
    }

    // Write JSON files if in JSON output mode
    if (this.options.jsonOutput) {
      await this.writeJsonFiles();
    }

    // Summary
    this.printSummary();

    if (!this.options.jsonOutput) {
      await pool.end();
    }
  }

  private async writeJsonFiles(): Promise<void> {
    const fs = await import('fs');
    const outputDir = path.join(__dirname, '../data/venues');
    
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log('\n📄 Writing JSON files to:', outputDir);

    for (const [cityId, venues] of this.venuesByCity) {
      const filename = `${cityId}-venues.json`;
      const filepath = path.join(outputDir, filename);
      fs.writeFileSync(filepath, JSON.stringify(venues, null, 2));
      console.log(`   ✅ ${filename} (${venues.length} venues)`);
    }

    // Also write a combined file
    const allVenues = Array.from(this.venuesByCity.values()).flat();
    const combinedPath = path.join(outputDir, 'all-venues.json');
    fs.writeFileSync(combinedPath, JSON.stringify(allVenues, null, 2));
    console.log(`   ✅ all-venues.json (${allVenues.length} total venues)`);
  }

  private async processCity(city: City): Promise<void> {
    console.log('\n' + '─'.repeat(70));
    console.log(`🏙️  ${city.name}, ${city.state}`);
    console.log('─'.repeat(70));

    // Ensure city exists in database (skip for JSON mode)
    if (!this.options.jsonOutput) {
      await this.ensureCityExists(city);
    }

    const seenPlaceIds = new Set<string>();
    let cityVenueCount = 0;

    // Process each category
    for (const category of CATEGORIES) {
      console.log(`\n📍 ${category.charAt(0).toUpperCase() + category.slice(1)}s`);

      // Tier 1: Awards
      for (const query of SEARCH_QUERIES.tier1[category] || []) {
        if (cityVenueCount >= this.options.targetPerCity) break;
        const added = await this.searchAndSave(city, `${query} ${city.name}`, category, seenPlaceIds);
        cityVenueCount += added;
      }

      // Tier 2: Curated
      for (const query of SEARCH_QUERIES.tier2[category] || []) {
        if (cityVenueCount >= this.options.targetPerCity) break;
        const added = await this.searchAndSave(city, `${query} ${city.name}`, category, seenPlaceIds);
        cityVenueCount += added;
      }

      // Tier 3: Types
      for (const query of SEARCH_QUERIES.tier3[category] || []) {
        if (cityVenueCount >= this.options.targetPerCity) break;
        const added = await this.searchAndSave(city, `best ${query} ${city.name}`, category, seenPlaceIds);
        cityVenueCount += added;
      }
    }

    // Tier 4: Neighborhood searches for coverage
    if (cityVenueCount < this.options.targetPerCity) {
      console.log(`\n📍 Neighborhood searches (${city.neighborhoods.length} areas)`);
      for (const hood of city.neighborhoods) {
        if (cityVenueCount >= this.options.targetPerCity) break;
        const added = await this.searchAndSave(city, `best restaurant ${hood}`, 'restaurant', seenPlaceIds);
        cityVenueCount += added;
        
        const addedBars = await this.searchAndSave(city, `best bar ${hood}`, 'bar', seenPlaceIds);
        cityVenueCount += addedBars;
      }
    }

    // Get current count
    if (this.options.jsonOutput) {
      const count = this.venuesByCity.get(city.id)?.length || 0;
      console.log(`\n✅ ${city.name}: ${count} venues collected for JSON`);
    } else {
      const countResult = await pool.query('SELECT COUNT(*) as count FROM venues WHERE city_id = $1', [city.id]);
      console.log(`\n✅ ${city.name}: ${countResult.rows[0].count} total venues`);
    }
  }

  private async searchAndSave(
    city: City,
    query: string,
    category: Category,
    seenPlaceIds: Set<string>
  ): Promise<number> {
    let added = 0;

    try {
      const places = await textSearch(query, { lat: city.lat, lng: city.lng });

      for (const place of places) {
        if (seenPlaceIds.has(place.id)) continue;
        seenPlaceIds.add(place.id);

        this.stats.total++;

        // Quality filter
        if (!place.rating || place.rating < this.options.minRating) {
          this.stats.lowQuality++;
          continue;
        }
        if (!place.userRatingCount || place.userRatingCount < this.options.minReviews) {
          this.stats.lowQuality++;
          continue;
        }
        if (place.businessStatus === 'CLOSED_PERMANENTLY') {
          this.stats.lowQuality++;
          continue;
        }

        const saved = await this.saveVenue(place, city.id, category);
        if (saved) {
          added++;
          this.stats.saved++;
        } else {
          this.stats.duplicates++;
        }
      }

      if (added > 0) {
        console.log(`   ✓ "${query.substring(0, 40)}..." → ${added} venues`);
      }
    } catch (error: any) {
      console.log(`   ⚠️ "${query.substring(0, 30)}...": ${error.message}`);
    }

    return added;
  }

  private async saveVenue(place: GooglePlace, cityId: string, category: Category): Promise<boolean> {
    // Check for duplicate (in-memory for JSON mode, DB for live mode)
    if (this.seenPlaceIds.has(place.id)) {
      return false;
    }

    if (!this.options.jsonOutput) {
      // Check database for duplicates
      const existing = await pool.query(
        `SELECT id FROM venues WHERE 
         google_place_id = $1 OR (LOWER(TRIM(name)) = LOWER($2) AND city_id = $3)
         LIMIT 1`,
        [place.id, place.displayName.text.trim(), cityId]
      );

      if (existing.rows.length > 0) {
        return false;
      }
    }

    this.seenPlaceIds.add(place.id);

    if (this.options.dryRun) {
      console.log(`   [DRY] ${place.displayName.text} (${place.rating}⭐, ${place.userRatingCount} reviews)`);
      return true;
    }

    // Map price level
    const priceMap: Record<string, string> = {
      'PRICE_LEVEL_INEXPENSIVE': '$',
      'PRICE_LEVEL_MODERATE': '$$',
      'PRICE_LEVEL_EXPENSIVE': '$$$',
      'PRICE_LEVEL_VERY_EXPENSIVE': '$$$$',
    };

    // Determine actual category from types
    const types = place.types || [];
    let actualCategory = category;
    if (types.includes('bar') || types.includes('night_club')) {
      actualCategory = 'bar';
    } else if (types.includes('cafe') || types.includes('coffee_shop')) {
      actualCategory = 'cafe';
    }

    // Extract cuisine
    const cuisineTypes = types.filter(t => t.includes('restaurant') && t !== 'restaurant');
    const cuisine = cuisineTypes.length > 0
      ? cuisineTypes[0].replace('_restaurant', '').replace(/_/g, ' ')
      : null;

    // Get photo URL (without API key - add via proxy)
    const imageUrl = place.photos?.[0]
      ? `${PLACES_BASE_URL}/${place.photos[0].name}/media?maxWidthPx=800`
      : null;

    const venueId = `venue_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const venueData = {
      id: venueId,
      name: place.displayName.text.trim(),
      city_id: cityId,
      category: actualCategory,
      cuisine: cuisine,
      price_range: priceMap[place.priceLevel || ''] || '$$',
      description: place.editorialSummary?.text || null,
      website: place.websiteUri || null,
      phone: place.nationalPhoneNumber || null,
      image_url: imageUrl,
      rating: place.rating,
      review_count: place.userRatingCount,
      coordinates: { lat: place.location.latitude, lng: place.location.longitude },
      features: types.filter(t => !t.includes('establishment')),
      google_place_id: place.id,
      google_maps_url: place.googleMapsUri || null,
      address: place.formattedAddress,
      source: 'google_places',
    };

    // JSON output mode - collect data
    if (this.options.jsonOutput) {
      if (!this.venuesByCity.has(cityId)) {
        this.venuesByCity.set(cityId, []);
      }
      this.venuesByCity.get(cityId)!.push(venueData);
      return true;
    }

    // Database mode - insert directly
    try {
      await pool.query(
        `INSERT INTO venues (
          id, name, city_id, category, cuisine, price_range,
          description, website, phone, image_url, rating, review_count,
          coordinates, features, google_place_id, google_maps_url,
          address, source, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, 'google_places', NOW(), NOW()
        )`,
        [
          venueData.id,
          venueData.name,
          venueData.city_id,
          venueData.category,
          venueData.cuisine,
          venueData.price_range,
          venueData.description,
          venueData.website,
          venueData.phone,
          venueData.image_url,
          venueData.rating,
          venueData.review_count,
          JSON.stringify(venueData.coordinates),
          JSON.stringify(venueData.features),
          venueData.google_place_id,
          venueData.google_maps_url,
          venueData.address,
        ]
      );
      return true;
    } catch (error: any) {
      console.log(`   ❌ ${place.displayName.text}: ${error.message}`);
      return false;
    }
  }

  private async ensureCityExists(city: City): Promise<void> {
    const existing = await pool.query('SELECT id FROM cities WHERE id = $1', [city.id]);
    
    if (existing.rows.length === 0) {
      console.log(`   Creating city: ${city.name}`);
      if (!this.options.dryRun) {
        await pool.query(
          `INSERT INTO cities (id, name, state, country, description, coordinates, image_url)
           VALUES ($1, $2, $3, 'USA', $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [
            city.id,
            city.name,
            city.state,
            `Discover the best restaurants, bars, and cafes in ${city.name}`,
            JSON.stringify({ lat: city.lat, lng: city.lng }),
            `https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800`, // Default
          ]
        );
      }
    }
  }

  private printSummary(): void {
    console.log('\n' + '═'.repeat(70));
    console.log('📊 SCRAPING COMPLETE');
    console.log('═'.repeat(70));
    console.log(`Total found:    ${this.stats.total}`);
    console.log(`Saved:          ${this.stats.saved}`);
    console.log(`Duplicates:     ${this.stats.duplicates}`);
    console.log(`Low quality:    ${this.stats.lowQuality}`);
    console.log(`API requests:   ${requestCount}`);
    if (this.options.dryRun) {
      console.log('\n⚠️  DRY RUN - No data was saved');
    }
    console.log('═'.repeat(70));
  }

  private printHelp(): void {
    console.log(`
Available cities:
  Phase 1: nyc, la, chicago, sf, miami
  Phase 2: houston, austin, vegas, philly, seattle
  Phase 3: nola, boston, dc, nashville, portland

Usage examples:
  npx ts-node scripts/seed-google-places.ts --city sf
  npx ts-node scripts/seed-google-places.ts --cities sf,austin,seattle
  npx ts-node scripts/seed-google-places.ts --phase 2
  npx ts-node scripts/seed-google-places.ts --min-rating 4.0 --target 150
`);
  }
}

// ============================================================================
// CLI PARSING
// ============================================================================

function parseArgs(): ScraperOptions {
  const args = process.argv.slice(2);
  const options: ScraperOptions = {
    dryRun: false,
    jsonOutput: false,
    minRating: DEFAULT_MIN_RATING,
    minReviews: DEFAULT_MIN_REVIEWS,
    targetPerCity: DEFAULT_TARGET_PER_CITY,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--json':
        options.jsonOutput = true;
        break;
      case '--city':
        options.cities = [args[++i]];
        break;
      case '--cities':
        options.cities = args[++i].split(',');
        break;
      case '--phase':
        options.phase = parseInt(args[++i], 10);
        break;
      case '--min-rating':
        options.minRating = parseFloat(args[++i]);
        break;
      case '--min-reviews':
        options.minReviews = parseInt(args[++i], 10);
        break;
      case '--target':
        options.targetPerCity = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`
🗺️  Localist Venue Scraper
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Scrapes high-quality venues from Google Places API for all 15 MVP cities.

Usage:
  npx ts-node scripts/seed-google-places.ts [options]

Options:
  --city <id>         Single city (e.g., --city sf)
  --cities <ids>      Multiple cities (e.g., --cities sf,austin)
  --phase <1|2|3>     All cities in phase
  --min-rating <n>    Minimum star rating (default: ${DEFAULT_MIN_RATING})
  --min-reviews <n>   Minimum review count (default: ${DEFAULT_MIN_REVIEWS})
  --target <n>        Target venues per city (default: ${DEFAULT_TARGET_PER_CITY})
  --json              Output to JSON files (data/venues/) instead of database
  --dry-run           Preview without saving
  --help              Show this help

Cities:
  Phase 1: nyc, la, chicago, sf, miami
  Phase 2: houston, austin, vegas, philly, seattle
  Phase 3: nola, boston, dc, nashville, portland

Examples:
  npx ts-node scripts/seed-google-places.ts                       # All cities
  npx ts-node scripts/seed-google-places.ts --city austin         # Just Austin
  npx ts-node scripts/seed-google-places.ts --phase 2             # Phase 2 cities
  npx ts-node scripts/seed-google-places.ts --min-rating 4.0      # Lower threshold
  npx ts-node scripts/seed-google-places.ts --dry-run --city nyc  # Preview NYC
`);
        process.exit(0);
    }
  }

  return options;
}

// ============================================================================
// MAIN
// ============================================================================

const options = parseArgs();
const scraper = new VenueScraper(options);
scraper.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
