#!/usr/bin/env ts-node
/**
 * Seed Venue Data from Google Places API
 * 
 * Uses Google Maps Places API (New) to discover and populate real venue data
 * for the initial 5 cities: NYC, LA, Chicago, Miami, Las Vegas
 * 
 * Usage:
 *   npx ts-node scripts/seed-google-places.ts
 *   npx ts-node scripts/seed-google-places.ts --city nyc
 *   npx ts-node scripts/seed-google-places.ts --category bar
 *   npx ts-node scripts/seed-google-places.ts --dry-run
 *   npx ts-node scripts/seed-google-places.ts --limit 100
 * 
 * Prerequisites:
 *   - GOOGLE_MAPS_API_KEY environment variable set
 *   - Places API enabled in Google Cloud Console
 *   - PostgreSQL database running
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env.local'), override: true });
dotenv.config({ path: path.join(__dirname, '../.env'), override: true });

import pool from '../src/config/database';
import googlePlacesService, { VenueFromGoogle } from '../src/services/google-places.service';
import logger from '../src/services/logger.service';

// Cities to seed
const CITIES = [
  { id: 'nyc', name: 'New York City', state: 'NY' },
  { id: 'la', name: 'Los Angeles', state: 'CA' },
  { id: 'chicago', name: 'Chicago', state: 'IL' },
  { id: 'miami', name: 'Miami', state: 'FL' },
  { id: 'vegas', name: 'Las Vegas', state: 'NV' },
];

const CATEGORIES = ['restaurant', 'bar', 'cafe'] as const;
type Category = typeof CATEGORIES[number];

interface SeedOptions {
  dryRun: boolean;
  city?: string;
  category?: Category;
  limit: number;
  includeNeighborhoods: boolean;
}

class GooglePlacesSeeder {
  private options: SeedOptions;
  private venueCount = 0;
  private duplicateCount = 0;
  private failedCount = 0;

  constructor(options: SeedOptions) {
    this.options = options;
  }

  async run(): Promise<void> {
    console.log('\n' + '='.repeat(70));
    console.log('🗺️  GOOGLE PLACES VENUE SEEDER');
    console.log('='.repeat(70));
    console.log(`Mode: ${this.options.dryRun ? '🔍 DRY RUN (no database writes)' : '💾 LIVE'}`);
    console.log(`Target City: ${this.options.city || 'All 5 cities'}`);
    console.log(`Category: ${this.options.category || 'All categories'}`);
    console.log(`Limit: ${this.options.limit} venues per city/category`);
    console.log(`Include Neighborhoods: ${this.options.includeNeighborhoods}`);
    console.log('='.repeat(70) + '\n');

    // Check API availability
    if (!googlePlacesService.isAvailable()) {
      console.error('❌ GOOGLE_MAPS_API_KEY not set!');
      console.log('\nTo set up:');
      console.log('  1. Run: gcloud auth login');
      console.log('  2. Enable Places API in Google Cloud Console');
      console.log('  3. Create API key: gcloud services api-keys create --display-name="Localist Places"');
      console.log('  4. Add to .env: GOOGLE_MAPS_API_KEY=your_key_here');
      process.exit(1);
    }
    console.log('✅ Google Places API key configured\n');

    // Get cities to process
    const citiesToProcess = this.options.city
      ? CITIES.filter(c => c.id === this.options.city)
      : CITIES;

    if (citiesToProcess.length === 0) {
      console.error(`❌ City "${this.options.city}" not found`);
      console.log(`Available cities: ${CITIES.map(c => c.id).join(', ')}`);
      process.exit(1);
    }

    // Get categories to process
    const categoriesToProcess = this.options.category
      ? [this.options.category]
      : CATEGORIES;

    // Process each city
    for (const city of citiesToProcess) {
      await this.ensureCityExists(city);

      for (const category of categoriesToProcess) {
        await this.discoverAndSaveVenues(city, category);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 SEEDING COMPLETE');
    console.log('='.repeat(70));
    console.log(`✅ Venues saved: ${this.venueCount}`);
    console.log(`⏭️  Duplicates skipped: ${this.duplicateCount}`);
    console.log(`❌ Failed: ${this.failedCount}`);
    
    if (this.options.dryRun) {
      console.log('\n⚠️  DRY RUN - No data was actually saved to the database');
    }

    await pool.end();
  }

  private async ensureCityExists(city: { id: string; name: string; state: string }): Promise<void> {
    const coords: Record<string, { lat: number; lng: number }> = {
      nyc: { lat: 40.7128, lng: -74.006 },
      la: { lat: 34.0522, lng: -118.2437 },
      chicago: { lat: 41.8781, lng: -87.6298 },
      miami: { lat: 25.7617, lng: -80.1918 },
      vegas: { lat: 36.1699, lng: -115.1398 },
    };

    const existing = await pool.query('SELECT id FROM cities WHERE id = $1', [city.id]);
    
    if (existing.rows.length === 0) {
      console.log(`📍 Creating city: ${city.name}, ${city.state}`);
      
      if (!this.options.dryRun) {
        await pool.query(
          `INSERT INTO cities (id, name, state, country, description, coordinates)
           VALUES ($1, $2, $3, 'USA', $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [
            city.id,
            city.name,
            city.state,
            `Discover the best food and drinks in ${city.name}`,
            JSON.stringify(coords[city.id] || { lat: 0, lng: 0 }),
          ]
        );
      }
    }
  }

  private async discoverAndSaveVenues(
    city: { id: string; name: string },
    category: Category
  ): Promise<void> {
    console.log('\n' + '-'.repeat(60));
    console.log(`🏙️  ${city.name} - ${category}s`);
    console.log('-'.repeat(60));

    try {
      const venues = await googlePlacesService.discoverVenuesInCity(city.id, {
        category,
        limit: this.options.limit,
        includeNeighborhoods: this.options.includeNeighborhoods,
      });

      console.log(`Found ${venues.length} venues from Google Places API`);

      for (const venue of venues) {
        await this.saveVenue(venue);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Error discovering ${category}s in ${city.name}: ${message}`);
    }
  }

  private async saveVenue(venue: VenueFromGoogle): Promise<boolean> {
    try {
      // Check for duplicates by name + city or google_place_id
      const existing = await pool.query(
        `SELECT id FROM venues 
         WHERE (LOWER(TRIM(name)) = LOWER($1) AND city_id = $2)
            OR google_place_id = $3
         LIMIT 1`,
        [venue.name.trim(), venue.city_id, venue.google_place_id]
      );

      if (existing.rows.length > 0) {
        this.duplicateCount++;
        return false;
      }

      if (this.options.dryRun) {
        console.log(`  [DRY] ${venue.name} (${venue.category}, ${venue.price_range})`);
        this.venueCount++;
        return true;
      }

      const id = `venue_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      await pool.query(
        `INSERT INTO venues (
          id, name, address, city_id, category, cuisine, price_range,
          description, website, phone, image_url, rating, review_count,
          coordinates, features, google_place_id, neighborhood,
          opening_hours, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()
        )`,
        [
          id,
          venue.name,
          venue.address,
          venue.city_id,
          venue.category,
          venue.cuisine,
          venue.price_range,
          venue.description,
          venue.website,
          venue.phone,
          venue.image_url,
          venue.rating,
          venue.review_count,
          JSON.stringify(venue.coordinates),
          JSON.stringify(venue.features),
          venue.google_place_id,
          venue.neighborhood,
          venue.opening_hours ? JSON.stringify(venue.opening_hours) : null,
        ]
      );

      this.venueCount++;
      console.log(`  ✅ ${venue.name} (${venue.category}, ${venue.price_range}, ⭐${venue.rating || 'N/A'})`);
      return true;
    } catch (error: unknown) {
      this.failedCount++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Failed: ${venue.name} - ${message}`);
      return false;
    }
  }
}

// Parse command line arguments
function parseArgs(): SeedOptions {
  const args = process.argv.slice(2);
  const options: SeedOptions = {
    dryRun: false,
    limit: 50,
    includeNeighborhoods: true,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--city':
        options.city = args[++i];
        break;
      case '--category':
        const cat = args[++i];
        if (CATEGORIES.includes(cat as Category)) {
          options.category = cat as Category;
        } else {
          console.error(`Invalid category: ${cat}. Use: ${CATEGORIES.join(', ')}`);
          process.exit(1);
        }
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--no-neighborhoods':
        options.includeNeighborhoods = false;
        break;
      case '--help':
        console.log(`
Usage: npx ts-node scripts/seed-google-places.ts [options]

Options:
  --dry-run           Don't write to database, just show what would be saved
  --city <id>         Only seed specific city (nyc, la, chicago, miami, vegas)
  --category <cat>    Only seed specific category (restaurant, bar, cafe)
  --limit <n>         Max venues per city/category (default: 50)
  --no-neighborhoods  Don't search by neighborhood (faster but fewer results)
  --help              Show this help

Examples:
  npx ts-node scripts/seed-google-places.ts --dry-run
  npx ts-node scripts/seed-google-places.ts --city nyc --limit 100
  npx ts-node scripts/seed-google-places.ts --category bar --no-neighborhoods
`);
        process.exit(0);
    }
  }

  return options;
}

// Run
const seeder = new GooglePlacesSeeder(parseArgs());
seeder.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

