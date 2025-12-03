#!/usr/bin/env ts-node
/**
 * Seed Venues from Google Places API
 * 
 * Uses Google Places API (New) with quality filtering to discover high-rated venues.
 * Only includes venues with 4.6+ stars rating.
 * 
 * Usage:
 *   npx ts-node scripts/seed-google-places.ts
 *   npx ts-node scripts/seed-google-places.ts --city sf
 *   npx ts-node scripts/seed-google-places.ts --phase 2
 *   npx ts-node scripts/seed-google-places.ts --new-cities
 *   npx ts-node scripts/seed-google-places.ts --dry-run
 * 
 * Prerequisites:
 *   - GOOGLE_MAPS_API_KEY environment variable set
 *   - PostgreSQL database running
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env.local'), override: true });

import pool from '../src/config/database';
import logger from '../src/services/logger.service';

// Google Places API configuration
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_BASE_URL = 'https://places.googleapis.com/v1';

// Quality threshold: 4.6 stars minimum
const MIN_RATING = 4.6;
const MIN_REVIEWS = 50;

// All 15 MVP cities with coordinates
const CITIES = [
  // Phase 1 (original 5)
  { id: 'nyc', name: 'New York City', state: 'NY', phase: 1, lat: 40.7580, lng: -73.9855 },
  { id: 'la', name: 'Los Angeles', state: 'CA', phase: 1, lat: 34.0522, lng: -118.2437 },
  { id: 'chicago', name: 'Chicago', state: 'IL', phase: 1, lat: 41.8827, lng: -87.6233 },
  { id: 'sf', name: 'San Francisco', state: 'CA', phase: 1, lat: 37.7749, lng: -122.4194 },
  { id: 'miami', name: 'Miami', state: 'FL', phase: 1, lat: 25.7617, lng: -80.1918 },
  // Phase 2 (new)
  { id: 'houston', name: 'Houston', state: 'TX', phase: 2, lat: 29.7604, lng: -95.3698 },
  { id: 'austin', name: 'Austin', state: 'TX', phase: 2, lat: 30.2672, lng: -97.7431 },
  { id: 'vegas', name: 'Las Vegas', state: 'NV', phase: 2, lat: 36.1147, lng: -115.1728 },
  { id: 'philly', name: 'Philadelphia', state: 'PA', phase: 2, lat: 39.9526, lng: -75.1652 },
  { id: 'seattle', name: 'Seattle', state: 'WA', phase: 2, lat: 47.6062, lng: -122.3321 },
  // Phase 3 (new)
  { id: 'nola', name: 'New Orleans', state: 'LA', phase: 3, lat: 29.9511, lng: -90.0715 },
  { id: 'boston', name: 'Boston', state: 'MA', phase: 3, lat: 42.3601, lng: -71.0589 },
  { id: 'dc', name: 'Washington', state: 'DC', phase: 3, lat: 38.9072, lng: -77.0369 },
  { id: 'nashville', name: 'Nashville', state: 'TN', phase: 3, lat: 36.1627, lng: -86.7816 },
  { id: 'portland', name: 'Portland', state: 'OR', phase: 3, lat: 45.5152, lng: -122.6784 },
];

// Neighborhoods for each city (for granular searches)
const NEIGHBORHOODS: Record<string, string[]> = {
  // Phase 2 cities
  houston: [
    'Montrose Houston', 'Heights Houston', 'Midtown Houston', 'Downtown Houston',
    'Rice Village Houston', 'River Oaks Houston', 'EaDo Houston', 'Upper Kirby Houston',
    'Memorial Houston', 'Galleria Houston', 'Museum District Houston', 'Washington Avenue Houston',
  ],
  austin: [
    'Downtown Austin', 'South Congress Austin', 'East Austin', 'Rainey Street Austin',
    'South Lamar Austin', 'Hyde Park Austin', 'Mueller Austin', 'Domain Austin',
    'Zilker Austin', 'Clarksville Austin', '6th Street Austin', 'West Campus Austin',
  ],
  vegas: [
    'The Strip Las Vegas', 'Downtown Fremont Street', 'Arts District Las Vegas',
    'Summerlin Las Vegas', 'Henderson Nevada', 'Chinatown Las Vegas', 'Spring Valley Las Vegas',
  ],
  philly: [
    'Center City Philadelphia', 'Old City Philadelphia', 'Rittenhouse Square',
    'Fishtown Philadelphia', 'Northern Liberties Philadelphia', 'South Philadelphia',
    'University City Philadelphia', 'Manayunk Philadelphia', 'East Passyunk Philadelphia',
  ],
  seattle: [
    'Capitol Hill Seattle', 'Ballard Seattle', 'Fremont Seattle', 'Queen Anne Seattle',
    'South Lake Union Seattle', 'Downtown Seattle', 'Pike Place Market', 'Wallingford Seattle',
    'Georgetown Seattle', 'Columbia City Seattle', 'University District Seattle',
  ],
  // Phase 3 cities
  nola: [
    'French Quarter New Orleans', 'Garden District New Orleans', 'Marigny New Orleans',
    'Bywater New Orleans', 'CBD New Orleans', 'Warehouse District New Orleans',
    'Uptown New Orleans', 'Mid-City New Orleans', 'Frenchmen Street New Orleans',
  ],
  boston: [
    'Back Bay Boston', 'South End Boston', 'North End Boston', 'Seaport Boston',
    'Cambridge Massachusetts', 'Somerville Massachusetts', 'Beacon Hill Boston',
    'Fenway Boston', 'Jamaica Plain Boston', 'Brookline Massachusetts',
  ],
  dc: [
    'Georgetown Washington DC', 'Dupont Circle Washington DC', 'Adams Morgan Washington DC',
    'Capitol Hill Washington DC', 'Shaw Washington DC', 'U Street Washington DC',
    'Penn Quarter Washington DC', '14th Street Washington DC', 'Navy Yard Washington DC',
  ],
  nashville: [
    'Downtown Nashville', 'East Nashville', 'The Gulch Nashville', 'Germantown Nashville',
    '12 South Nashville', 'Hillsboro Village Nashville', 'Midtown Nashville',
    'West End Nashville', 'Music Row Nashville', 'Five Points Nashville',
  ],
  portland: [
    'Pearl District Portland', 'Alberta Arts District Portland', 'Southeast Portland',
    'Northwest Portland', 'Division Street Portland', 'Mississippi Avenue Portland',
    'Hawthorne Portland', 'Downtown Portland', 'St Johns Portland', 'Sellwood Portland',
  ],
};

// Search queries for high-quality venues
const SEARCH_QUERIES = {
  restaurant: [
    'best restaurant',
    'top rated restaurant',
    'fine dining',
    'best new restaurant 2024',
    'michelin restaurant',
    'james beard restaurant',
    'best italian restaurant',
    'best japanese restaurant',
    'best mexican restaurant',
    'best sushi',
    'best steakhouse',
    'best seafood restaurant',
    'best brunch',
    'best date night restaurant',
    'farm to table restaurant',
    'tasting menu',
    'omakase',
  ],
  bar: [
    'best cocktail bar',
    'best bar',
    'craft cocktail bar',
    'speakeasy',
    'rooftop bar',
    'wine bar',
    'best happy hour',
    'whiskey bar',
    'jazz bar',
    'best hotel bar',
  ],
  cafe: [
    'best coffee shop',
    'specialty coffee',
    'best cafe',
    'artisan bakery',
    'best brunch cafe',
  ],
};

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

class GooglePlacesSeeder {
  private dryRun: boolean;
  private targetCity?: string;
  private targetPhase?: number;
  private newCitiesOnly: boolean;
  private venueCount = 0;
  private skippedCount = 0;
  private requestCount = 0;

  constructor(options: { 
    dryRun?: boolean; 
    city?: string; 
    phase?: number;
    newCitiesOnly?: boolean;
  } = {}) {
    this.dryRun = options.dryRun || false;
    this.targetCity = options.city;
    this.targetPhase = options.phase;
    this.newCitiesOnly = options.newCitiesOnly || false;
  }

  async run(): Promise<void> {
    console.log('🚀 Google Places Venue Seeding\n');
    console.log(`Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Quality Filter: ≥${MIN_RATING}⭐ rating, ≥${MIN_REVIEWS} reviews\n`);

    if (!API_KEY) {
      console.error('❌ GOOGLE_MAPS_API_KEY environment variable not set');
      process.exit(1);
    }

    // Determine which cities to process
    let citiesToProcess = CITIES;
    
    if (this.targetCity) {
      citiesToProcess = CITIES.filter(c => c.id === this.targetCity);
    } else if (this.targetPhase) {
      citiesToProcess = CITIES.filter(c => c.phase === this.targetPhase);
    } else if (this.newCitiesOnly) {
      // Phase 2 and 3 only (the 10 new cities)
      citiesToProcess = CITIES.filter(c => c.phase >= 2);
    }

    if (citiesToProcess.length === 0) {
      console.error('❌ No cities matched your criteria');
      this.printHelp();
      process.exit(1);
    }

    console.log(`Processing ${citiesToProcess.length} cities:`);
    citiesToProcess.forEach(c => console.log(`  - ${c.name}, ${c.state} (Phase ${c.phase})`));
    console.log('');

    for (const city of citiesToProcess) {
      await this.processCity(city);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SEEDING COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total venues saved: ${this.venueCount}`);
    console.log(`Skipped (low rating/duplicate): ${this.skippedCount}`);
    console.log(`Google API requests: ${this.requestCount}`);
    if (this.dryRun) {
      console.log('\n⚠️  DRY RUN - No data was saved');
    }

    await pool.end();
  }

  private async processCity(city: typeof CITIES[0]): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log(`🏙️  ${city.name}, ${city.state}`);
    console.log('='.repeat(60));

    // Ensure city exists
    await this.ensureCityExists(city);

    // Search for restaurants
    console.log('\n🍽️  Discovering restaurants...');
    for (const query of SEARCH_QUERIES.restaurant) {
      await this.searchAndSave(city, query, 'restaurant');
    }

    // Search for bars
    console.log('\n🍸 Discovering bars...');
    for (const query of SEARCH_QUERIES.bar) {
      await this.searchAndSave(city, query, 'bar');
    }

    // Search for cafes
    console.log('\n☕ Discovering cafes...');
    for (const query of SEARCH_QUERIES.cafe) {
      await this.searchAndSave(city, query, 'cafe');
    }

    // Neighborhood searches
    const neighborhoods = NEIGHBORHOODS[city.id] || [];
    if (neighborhoods.length > 0) {
      console.log(`\n📍 Neighborhood searches (${neighborhoods.length} areas)...`);
      for (const hood of neighborhoods) {
        await this.searchAndSave(city, `best restaurant ${hood}`, 'restaurant');
        await this.searchAndSave(city, `best bar ${hood}`, 'bar');
        await this.delay(500); // Rate limit
      }
    }

    // Get current count for this city
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM venues WHERE city_id = $1',
      [city.id]
    );
    console.log(`\n✅ ${city.name} now has ${countResult.rows[0].count} venues`);
  }

  private async searchAndSave(
    city: typeof CITIES[0],
    query: string,
    category: string
  ): Promise<void> {
    const fullQuery = `${query} ${city.name} ${city.state}`;
    
    try {
      const places = await this.textSearch(fullQuery, {
        lat: city.lat,
        lng: city.lng,
      });

      let savedInQuery = 0;
      for (const place of places) {
        const saved = await this.saveVenue(place, city.id, category);
        if (saved) savedInQuery++;
      }

      if (savedInQuery > 0) {
        console.log(`  ✓ "${query}" → ${savedInQuery} venues`);
      }
    } catch (error: any) {
      console.log(`  ⚠️ "${query}" failed: ${error.message}`);
    }
  }

  private async textSearch(
    query: string, 
    location: { lat: number; lng: number }
  ): Promise<GooglePlace[]> {
    await this.rateLimit();
    this.requestCount++;

    const fieldMask = [
      'places.id',
      'places.displayName',
      'places.formattedAddress',
      'places.location',
      'places.types',
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

    const response = await fetch(`${PLACES_BASE_URL}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY!,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 20,
        languageCode: 'en',
        locationBias: {
          circle: {
            center: { latitude: location.lat, longitude: location.lng },
            radius: 25000,
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error ${response.status}: ${error}`);
    }

    const data = await response.json();
    return data.places || [];
  }

  private async saveVenue(
    place: GooglePlace, 
    cityId: string,
    category: string
  ): Promise<boolean> {
    // Quality filter: 4.6 stars minimum
    if (!place.rating || place.rating < MIN_RATING) {
      this.skippedCount++;
      return false;
    }

    // Review count filter
    if (!place.userRatingCount || place.userRatingCount < MIN_REVIEWS) {
      this.skippedCount++;
      return false;
    }

    // Skip closed businesses
    if (place.businessStatus === 'CLOSED_PERMANENTLY') {
      this.skippedCount++;
      return false;
    }

    // Check for duplicate
    const existing = await pool.query(
      `SELECT id FROM venues WHERE 
       (LOWER(TRIM(name)) = LOWER($1) AND city_id = $2)
       OR google_place_id = $3
       LIMIT 1`,
      [place.displayName.text.trim(), cityId, place.id]
    );

    if (existing.rows.length > 0) {
      this.skippedCount++;
      return false;
    }

    if (this.dryRun) {
      console.log(`    [DRY] ${place.displayName.text} (${place.rating}⭐)`);
      this.venueCount++;
      return true;
    }

    // Map price level
    const priceMap: Record<string, string> = {
      'PRICE_LEVEL_INEXPENSIVE': '$',
      'PRICE_LEVEL_MODERATE': '$$',
      'PRICE_LEVEL_EXPENSIVE': '$$$',
      'PRICE_LEVEL_VERY_EXPENSIVE': '$$$$',
    };

    // Determine category from types
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

    // Get photo URL
    const imageUrl = place.photos?.[0]
      ? `${PLACES_BASE_URL}/${place.photos[0].name}/media?maxWidthPx=800&key=${API_KEY}`
      : null;

    const venueId = `venue_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    try {
      await pool.query(
        `INSERT INTO venues (
          id, name, city_id, category, cuisine, price_range,
          description, website, phone, image_url, rating, review_count,
          coordinates, features, google_place_id, google_maps_url,
          source, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, 'google_places', NOW(), NOW()
        )`,
        [
          venueId,
          place.displayName.text.trim(),
          cityId,
          actualCategory,
          cuisine,
          priceMap[place.priceLevel || ''] || '$$',
          place.editorialSummary?.text || null,
          place.websiteUri || null,
          place.nationalPhoneNumber || null,
          imageUrl,
          place.rating,
          place.userRatingCount,
          JSON.stringify({ lat: place.location.latitude, lng: place.location.longitude }),
          JSON.stringify(types.filter(t => !t.includes('establishment'))),
          place.id,
          place.googleMapsUri || null,
        ]
      );

      this.venueCount++;
      return true;
    } catch (error: any) {
      console.log(`    ❌ Failed: ${place.displayName.text} - ${error.message}`);
      return false;
    }
  }

  private async ensureCityExists(city: typeof CITIES[0]): Promise<void> {
    const existing = await pool.query('SELECT id FROM cities WHERE id = $1', [city.id]);
    
    if (existing.rows.length === 0) {
      console.log(`  Creating city: ${city.name}`);
      if (!this.dryRun) {
        await pool.query(
          `INSERT INTO cities (id, name, state, country, description, coordinates)
           VALUES ($1, $2, $3, 'USA', $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [
            city.id,
            city.name,
            city.state,
            `Discover the best restaurants and bars in ${city.name}`,
            JSON.stringify({ lat: city.lat, lng: city.lng }),
          ]
        );
      }
    }
  }

  private async rateLimit(): Promise<void> {
    // Google allows 600 QPM, we'll be conservative at 200ms between requests
    await this.delay(200);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private printHelp(): void {
    console.log(`
Available options:
  --dry-run       Run without saving to database
  --city <id>     Process single city
  --phase <1-3>   Process cities in specific phase
  --new-cities    Process only Phase 2 & 3 cities (10 new cities)

City IDs:
  Phase 1: nyc, la, chicago, sf, miami
  Phase 2: houston, austin, vegas, philly, seattle
  Phase 3: nola, boston, dc, nashville, portland
`);
  }
}

// Parse arguments
const args = process.argv.slice(2);
const options: { dryRun?: boolean; city?: string; phase?: number; newCitiesOnly?: boolean } = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') {
    options.dryRun = true;
  } else if (args[i] === '--city' && args[i + 1]) {
    options.city = args[i + 1];
    i++;
  } else if (args[i] === '--phase' && args[i + 1]) {
    options.phase = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--new-cities') {
    options.newCitiesOnly = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Google Places Venue Seeder
--------------------------
Seeds venues from Google Places API with 4.6+ star rating filter.

Usage:
  npx ts-node scripts/seed-google-places.ts [options]

Options:
  --dry-run       Preview without saving
  --city <id>     Single city (e.g., --city sf)
  --phase <1-3>   Cities in phase (e.g., --phase 2)
  --new-cities    Phase 2 & 3 only (10 new cities)
  --help          Show this help

Examples:
  npx ts-node scripts/seed-google-places.ts --new-cities
  npx ts-node scripts/seed-google-places.ts --phase 2 --dry-run
  npx ts-node scripts/seed-google-places.ts --city austin
`);
    process.exit(0);
  }
}

// Run
const seeder = new GooglePlacesSeeder(options);
seeder.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
