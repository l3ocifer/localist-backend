#!/usr/bin/env ts-node
/**
 * High-Quality Venue Seeding from Google Places API
 * 
 * Uses a tiered search strategy to discover only the best venues:
 *   Tier 1: Award-winning (Michelin, James Beard, etc.)
 *   Tier 2: Curated lists (Eater 38, Infatuation, etc.)
 *   Tier 3: Specific high-quality types (speakeasy, omakase, etc.)
 *   Tier 4: Neighborhood coverage
 * 
 * Quality Filters (default):
 *   - Rating ≥ 4.2 stars
 *   - Reviews ≥ 100
 *   - Must have photos
 *   - Must have website or phone
 *   - Must not be permanently closed
 * 
 * Usage:
 *   npx ts-node scripts/seed-google-places.ts --dry-run
 *   npx ts-node scripts/seed-google-places.ts --city nyc --target 300
 *   npx ts-node scripts/seed-google-places.ts --category bar --min-rating 4.0 --min-reviews 50
 *   npx ts-node scripts/seed-google-places.ts --all-cities --all-categories
 * 
 * Prerequisites:
 *   - GOOGLE_MAPS_API_KEY environment variable
 *   - Places API enabled in Google Cloud Console
 *   - PostgreSQL database running
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env.local'), override: true });
dotenv.config({ path: path.join(__dirname, '../.env'), override: true });

import pool from '../src/config/database';
import googlePlacesService, {
  VenueFromGoogle,
  QualityFilters,
  DEFAULT_QUALITY_FILTERS,
  RELAXED_QUALITY_FILTERS,
} from '../src/services/google-places.service';

// Cities to seed
const CITIES = ['nyc', 'la', 'chicago', 'miami', 'vegas'] as const;
type CityId = typeof CITIES[number];

const CITY_DETAILS: Record<CityId, { name: string; state: string; lat: number; lng: number }> = {
  nyc: { name: 'New York City', state: 'NY', lat: 40.7128, lng: -74.006 },
  la: { name: 'Los Angeles', state: 'CA', lat: 34.0522, lng: -118.2437 },
  chicago: { name: 'Chicago', state: 'IL', lat: 41.8781, lng: -87.6298 },
  miami: { name: 'Miami', state: 'FL', lat: 25.7617, lng: -80.1918 },
  vegas: { name: 'Las Vegas', state: 'NV', lat: 36.1699, lng: -115.1398 },
};

const CATEGORIES = ['restaurant', 'bar', 'cafe'] as const;
type Category = typeof CATEGORIES[number];

interface SeedOptions {
  dryRun: boolean;
  cities: CityId[];
  categories: Category[];
  targetPerCityCategory: number;
  qualityFilters: QualityFilters;
  skipTiers: number[];
  skipNeighborhoods: boolean;
}

class GooglePlacesSeeder {
  private options: SeedOptions;
  private stats = {
    venuesSaved: 0,
    duplicatesSkipped: 0,
    failedToSave: 0,
    apiRequests: 0,
  };

  constructor(options: SeedOptions) {
    this.options = options;
  }

  async run(): Promise<void> {
    this.printHeader();

    // Check API availability
    if (!googlePlacesService.isAvailable()) {
      console.error('\n❌ GOOGLE_MAPS_API_KEY not set!\n');
      console.log('Setup instructions:');
      console.log('  1. gcloud auth login');
      console.log('  2. gcloud services enable places.googleapis.com');
      console.log('  3. Get your API key from Google Cloud Console');
      console.log('  4. export GOOGLE_MAPS_API_KEY="your_key_here"');
      process.exit(1);
    }
    console.log('✅ Google Places API configured\n');

    const startTime = Date.now();

    // Process each city
    for (const cityId of this.options.cities) {
      await this.ensureCityExists(cityId);

      for (const category of this.options.categories) {
        await this.seedCityCategory(cityId, category);
      }
    }

    // Print summary
    this.printSummary(startTime);

    await pool.end();
  }

  private printHeader(): void {
    console.log('\n' + '═'.repeat(70));
    console.log('🗺️  GOOGLE PLACES HIGH-QUALITY VENUE SEEDER');
    console.log('═'.repeat(70));
    console.log(`Mode:       ${this.options.dryRun ? '🔍 DRY RUN' : '💾 LIVE'}`);
    console.log(`Cities:     ${this.options.cities.join(', ')}`);
    console.log(`Categories: ${this.options.categories.join(', ')}`);
    console.log(`Target:     ${this.options.targetPerCityCategory} venues per city/category`);
    console.log(`\nQuality Filters:`);
    console.log(`  • Rating:   ≥ ${this.options.qualityFilters.minRating} ⭐`);
    console.log(`  • Reviews:  ≥ ${this.options.qualityFilters.minReviews}`);
    console.log(`  • Photos:   ${this.options.qualityFilters.requirePhotos ? 'Required' : 'Optional'}`);
    console.log(`  • Contact:  ${this.options.qualityFilters.requireContact ? 'Required' : 'Optional'}`);
    console.log('═'.repeat(70));
  }

  private async ensureCityExists(cityId: CityId): Promise<void> {
    const city = CITY_DETAILS[cityId];
    const existing = await pool.query('SELECT id FROM cities WHERE id = $1', [cityId]);

    if (existing.rows.length === 0) {
      console.log(`\n📍 Creating city: ${city.name}, ${city.state}`);

      if (!this.options.dryRun) {
        await pool.query(
          `INSERT INTO cities (id, name, state, country, description, coordinates)
           VALUES ($1, $2, $3, 'USA', $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [
            cityId,
            city.name,
            city.state,
            `Discover the best food and drinks in ${city.name}`,
            JSON.stringify({ lat: city.lat, lng: city.lng }),
          ]
        );
      }
    }
  }

  private async seedCityCategory(cityId: CityId, category: Category): Promise<void> {
    const city = CITY_DETAILS[cityId];

    console.log('\n' + '─'.repeat(70));
    console.log(`🏙️  ${city.name} - ${category}s`);
    console.log('─'.repeat(70));

    try {
      const venues = await googlePlacesService.discoverQualityVenues(cityId, {
        category,
        targetCount: this.options.targetPerCityCategory,
        qualityFilters: this.options.qualityFilters,
        includeTier1: !this.options.skipTiers.includes(1),
        includeTier2: !this.options.skipTiers.includes(2),
        includeTier3: !this.options.skipTiers.includes(3),
        includeNeighborhoods: !this.options.skipNeighborhoods,
        onProgress: (msg) => console.log(msg),
      });

      console.log(`\n💾 Saving ${venues.length} venues to database...`);

      for (const venue of venues) {
        await this.saveVenue(venue);
      }

      const apiStats = googlePlacesService.getStats();
      this.stats.apiRequests = apiStats.requestCount;

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ Error: ${message}`);
    }
  }

  private async saveVenue(venue: VenueFromGoogle): Promise<boolean> {
    try {
      // Check for duplicates
      const existing = await pool.query(
        `SELECT id FROM venues 
         WHERE google_place_id = $1
            OR (LOWER(TRIM(name)) = LOWER($2) AND city_id = $3)
         LIMIT 1`,
        [venue.google_place_id, venue.name.trim(), venue.city_id]
      );

      if (existing.rows.length > 0) {
        this.stats.duplicatesSkipped++;
        return false;
      }

      if (this.options.dryRun) {
        console.log(`  [DRY] ${venue.name} (${venue.rating}⭐, ${venue.review_count} reviews)`);
        this.stats.venuesSaved++;
        return true;
      }

      const id = `venue_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      await pool.query(
        `INSERT INTO venues (
          id, name, address, city_id, category, cuisine, price_range,
          description, website, phone, image_url, rating, review_count,
          coordinates, features, google_place_id, neighborhood,
          opening_hours, source, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW()
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
          'google_places',
        ]
      );

      this.stats.venuesSaved++;
      console.log(`  ✅ ${venue.name} (${venue.rating}⭐, ${venue.review_count} reviews, ${venue.neighborhood || venue.city_id})`);
      return true;

    } catch (error: unknown) {
      this.stats.failedToSave++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Failed: ${venue.name} - ${message}`);
      return false;
    }
  }

  private printSummary(startTime: number): void {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '═'.repeat(70));
    console.log('📊 SEEDING COMPLETE');
    console.log('═'.repeat(70));
    console.log(`Duration:          ${duration}s`);
    console.log(`API Requests:      ${this.stats.apiRequests}`);
    console.log(`Venues Saved:      ${this.stats.venuesSaved}`);
    console.log(`Duplicates:        ${this.stats.duplicatesSkipped}`);
    console.log(`Failed:            ${this.stats.failedToSave}`);

    if (this.options.dryRun) {
      console.log('\n⚠️  DRY RUN - No data was written to the database');
      console.log('   Run without --dry-run to save venues');
    }

    console.log('═'.repeat(70) + '\n');
  }
}

// CLI Argument Parsing
function parseArgs(): SeedOptions {
  const args = process.argv.slice(2);

  const options: SeedOptions = {
    dryRun: false,
    cities: [],
    categories: [],
    targetPerCityCategory: 200,
    qualityFilters: { ...DEFAULT_QUALITY_FILTERS },
    skipTiers: [],
    skipNeighborhoods: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;

      case '--city':
        if (CITIES.includes(nextArg as CityId)) {
          options.cities.push(nextArg as CityId);
        } else {
          console.error(`Invalid city: ${nextArg}. Valid: ${CITIES.join(', ')}`);
          process.exit(1);
        }
        i++;
        break;

      case '--all-cities':
        options.cities = [...CITIES];
        break;

      case '--category':
        if (CATEGORIES.includes(nextArg as Category)) {
          options.categories.push(nextArg as Category);
        } else {
          console.error(`Invalid category: ${nextArg}. Valid: ${CATEGORIES.join(', ')}`);
          process.exit(1);
        }
        i++;
        break;

      case '--all-categories':
        options.categories = [...CATEGORIES];
        break;

      case '--target':
        options.targetPerCityCategory = parseInt(nextArg, 10);
        i++;
        break;

      case '--min-rating':
        options.qualityFilters.minRating = parseFloat(nextArg);
        i++;
        break;

      case '--min-reviews':
        options.qualityFilters.minReviews = parseInt(nextArg, 10);
        i++;
        break;

      case '--relaxed':
        options.qualityFilters = { ...RELAXED_QUALITY_FILTERS };
        break;

      case '--skip-tier':
        options.skipTiers.push(parseInt(nextArg, 10));
        i++;
        break;

      case '--skip-neighborhoods':
        options.skipNeighborhoods = true;
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  // Defaults
  if (options.cities.length === 0) {
    options.cities = ['nyc']; // Default to NYC
  }
  if (options.categories.length === 0) {
    options.categories = ['restaurant']; // Default to restaurants
  }

  return options;
}

function printHelp(): void {
  console.log(`
High-Quality Venue Seeder using Google Places API

USAGE:
  npx ts-node scripts/seed-google-places.ts [options]

OPTIONS:
  --dry-run              Don't write to database, just preview
  --city <id>            Seed specific city (can use multiple times)
                         Valid: nyc, la, chicago, miami, vegas
  --all-cities           Seed all 5 cities
  --category <cat>       Seed specific category (can use multiple times)
                         Valid: restaurant, bar, cafe
  --all-categories       Seed all categories
  --target <n>           Target venues per city/category (default: 200)
  --min-rating <n>       Minimum rating (default: 4.2)
  --min-reviews <n>      Minimum review count (default: 100)
  --relaxed              Use relaxed quality filters (4.0⭐, 50 reviews)
  --skip-tier <n>        Skip tier 1, 2, 3, or 4 searches
  --skip-neighborhoods   Skip neighborhood-based searches (faster)
  --help, -h             Show this help

EXAMPLES:
  # Preview NYC restaurants
  npx ts-node scripts/seed-google-places.ts --dry-run

  # Seed NYC bars with 300 target
  npx ts-node scripts/seed-google-places.ts --city nyc --category bar --target 300

  # Seed all cities, all categories
  npx ts-node scripts/seed-google-places.ts --all-cities --all-categories

  # Quick seed with relaxed filters
  npx ts-node scripts/seed-google-places.ts --relaxed --skip-neighborhoods

SEARCH TIERS:
  Tier 1: Award/recognition (Michelin, James Beard)
  Tier 2: Curated lists (Eater 38, Infatuation)
  Tier 3: Specific venue types (speakeasy, omakase)
  Tier 4: Neighborhood coverage
`);
}

// Main
const seeder = new GooglePlacesSeeder(parseArgs());
seeder.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
