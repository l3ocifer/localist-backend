#!/usr/bin/env ts-node
/**
 * Seed Real Venue Data
 * 
 * Uses Perplexica (AI-powered search) to discover and populate real venue data
 * for the 15 MVP cities as defined in the PRD.
 * 
 * Usage:
 *   npx ts-node scripts/seed-real-venues.ts
 *   npx ts-node scripts/seed-real-venues.ts --city nyc
 *   npx ts-node scripts/seed-real-venues.ts --phase 1
 *   npx ts-node scripts/seed-real-venues.ts --dry-run
 * 
 * Prerequisites:
 *   - Perplexica running at PERPLEXICA_URL (default: http://localhost:3002)
 *   - Or SearXNG running at SEARXNG_URL (default: http://localhost:8080)
 *   - PostgreSQL database running
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env.local'), override: true });

import pool from '../src/config/database';
import { PerplexicaScraperService } from '../src/services/perplexica-scraper.service';
import { SearXNGService } from '../src/services/searxng.service';
import logger from '../src/services/logger.service';

// Cities to seed - 15 MVP cities from PRD (ranked by population, Yelp activity, search volume)
const CITIES = [
  // Phase 1 (Immediate)
  { id: 'nyc', name: 'New York City', state: 'NY', phase: 1, population: 8300000 },
  { id: 'la', name: 'Los Angeles', state: 'CA', phase: 1, population: 4000000 },
  { id: 'chicago', name: 'Chicago', state: 'IL', phase: 1, population: 2700000 },
  { id: 'sf', name: 'San Francisco', state: 'CA', phase: 1, population: 815000 },
  { id: 'miami', name: 'Miami', state: 'FL', phase: 1, population: 470000 },
  // Phase 2 (Week 2)
  { id: 'houston', name: 'Houston', state: 'TX', phase: 2, population: 2350000 },
  { id: 'austin', name: 'Austin', state: 'TX', phase: 2, population: 1030000 },
  { id: 'vegas', name: 'Las Vegas', state: 'NV', phase: 2, population: 660000 },
  { id: 'philly', name: 'Philadelphia', state: 'PA', phase: 2, population: 1600000 },
  { id: 'seattle', name: 'Seattle', state: 'WA', phase: 2, population: 755000 },
  // Phase 3 (Week 3)
  { id: 'nola', name: 'New Orleans', state: 'LA', phase: 3, population: 390000 },
  { id: 'boston', name: 'Boston', state: 'MA', phase: 3, population: 680000 },
  { id: 'dc', name: 'Washington, DC', state: 'DC', phase: 3, population: 710000 },
  { id: 'nashville', name: 'Nashville', state: 'TN', phase: 3, population: 700000 },
  { id: 'portland', name: 'Portland', state: 'OR', phase: 3, population: 650000 },
];

// Categories to discover
const CATEGORIES = [
  'restaurants',
  'bars',
  'cafes',
  'cocktail bars',
  'breweries',
  'wine bars',
  'food halls',
  'bakeries',
];

// Specific venue types for more targeted searches
const VENUE_TYPES = {
  restaurants: [
    'best new restaurants',
    'michelin star restaurants',
    'best italian restaurants',
    'best mexican restaurants',
    'best asian restaurants',
    'best steakhouses',
    'best seafood restaurants',
    'best brunch spots',
    'best date night restaurants',
    'hidden gem restaurants',
  ],
  bars: [
    'best cocktail bars',
    'best speakeasy bars',
    'best rooftop bars',
    'best dive bars',
    'best wine bars',
    'best sports bars',
    'best jazz bars',
    'best hotel bars',
  ],
  cafes: [
    'best coffee shops',
    'best specialty coffee',
    'best cafes for working',
    'best brunch cafes',
  ],
};

interface VenueData {
  name: string;
  address?: string;
  city_id: string;
  category: string;
  cuisine?: string;
  price_range?: string;
  description?: string;
  website?: string;
  phone?: string;
  image_url?: string;
  rating?: number;
  coordinates?: { lat: number; lng: number };
  features?: string[];
  source?: string;
  neighborhood?: string;
}

class RealVenueSeeder {
  private perplexica: PerplexicaScraperService;
  private searxng: SearXNGService;
  private dryRun: boolean;
  private targetCity?: string;
  private targetPhase?: number;
  private venueCount = 0;
  private failedCount = 0;

  constructor(options: { dryRun?: boolean; city?: string; phase?: number } = {}) {
    this.perplexica = PerplexicaScraperService.getInstance();
    this.searxng = SearXNGService.getInstance();
    this.dryRun = options.dryRun || false;
    this.targetCity = options.city;
    this.targetPhase = options.phase;
  }

  async run(): Promise<void> {
    console.log('🚀 Starting Real Venue Seeding...\n');
    console.log(`Mode: ${this.dryRun ? 'DRY RUN (no database writes)' : 'LIVE'}`);
    
    let targetDescription = 'All 15 cities';
    if (this.targetCity) {
      targetDescription = `City: ${this.targetCity}`;
    } else if (this.targetPhase) {
      targetDescription = `Phase ${this.targetPhase} cities`;
    }
    console.log(`Target: ${targetDescription}\n`);

    // Check services
    await this.checkServices();

    // Get cities to process
    let citiesToProcess = CITIES;
    
    if (this.targetCity) {
      citiesToProcess = CITIES.filter(c => c.id === this.targetCity);
    } else if (this.targetPhase) {
      citiesToProcess = CITIES.filter(c => c.phase === this.targetPhase);
    }

    if (citiesToProcess.length === 0) {
      if (this.targetCity) {
        console.error(`❌ City "${this.targetCity}" not found`);
      } else if (this.targetPhase) {
        console.error(`❌ No cities found for phase ${this.targetPhase}`);
      }
      console.log('\nAvailable cities:');
      CITIES.forEach(c => console.log(`  ${c.id}: ${c.name} (Phase ${c.phase})`));
      process.exit(1);
    }

    console.log(`Processing ${citiesToProcess.length} cities:`);
    citiesToProcess.forEach(c => console.log(`  - ${c.name}, ${c.state}`));
    console.log('');

    // Process each city
    for (const city of citiesToProcess) {
      await this.processCity(city);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SEEDING COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total venues discovered: ${this.venueCount}`);
    console.log(`Failed to save: ${this.failedCount}`);
    if (this.dryRun) {
      console.log('\n⚠️  DRY RUN - No data was actually saved');
    }

    await pool.end();
  }

  private async checkServices(): Promise<void> {
    console.log('🔍 Checking available services...');
    
    const perplexicaUrl = process.env.PERPLEXICA_URL || 'http://localhost:3002';
    const searxngUrl = process.env.SEARXNG_URL || 'http://localhost:8080';
    
    let perplexicaAvailable = false;
    let searxngAvailable = false;

    try {
      const response = await fetch(`${perplexicaUrl}/api/health`);
      perplexicaAvailable = response.ok;
    } catch {
      // Try alternative endpoint
      try {
        const response = await fetch(`${perplexicaUrl}`);
        perplexicaAvailable = response.ok;
      } catch {}
    }

    try {
      searxngAvailable = await this.searxng.isAvailable();
    } catch {}

    console.log(`  Perplexica (${perplexicaUrl}): ${perplexicaAvailable ? '✅' : '❌'}`);
    console.log(`  SearXNG (${searxngUrl}): ${searxngAvailable ? '✅' : '❌'}`);

    if (!perplexicaAvailable && !searxngAvailable) {
      console.error('\n❌ No search services available!');
      console.log('\nPlease ensure either:');
      console.log('  1. Perplexica is running at PERPLEXICA_URL');
      console.log('  2. SearXNG is running at SEARXNG_URL');
      console.log('\nTo start Perplexica: docker compose up -d perplexica');
      process.exit(1);
    }

    console.log('');
  }

  private async processCity(city: { id: string; name: string; state: string; phase: number; population: number }): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log(`🏙️  Processing ${city.name}, ${city.state} (Phase ${city.phase}, Pop: ${city.population.toLocaleString()})`);
    console.log('='.repeat(60));

    // Ensure city exists in database
    await this.ensureCityExists(city);

    // Discover venues by category
    for (const category of CATEGORIES) {
      await this.discoverVenuesByCategory(city, category);
    }

    // Discover specific venue types
    for (const [category, searches] of Object.entries(VENUE_TYPES)) {
      for (const searchTerm of searches) {
        await this.discoverVenuesBySearch(city, category, searchTerm);
        // Rate limit
        await this.delay(2000);
      }
    }
  }

  private async ensureCityExists(city: { id: string; name: string; state: string; phase: number; population: number }): Promise<void> {
    const existing = await pool.query('SELECT id FROM cities WHERE id = $1', [city.id]);
    if (existing.rows.length === 0) {
      console.log(`  Creating city record for ${city.name}...`);
      if (!this.dryRun) {
        await pool.query(
          `INSERT INTO cities (id, name, state, country, description, coordinates)
           VALUES ($1, $2, $3, 'USA', $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [
            city.id,
            city.name,
            city.state,
            `Discover the best food and drinks in ${city.name}`,
            JSON.stringify(this.getCityCoordinates(city.id)),
          ]
        );
      }
    } else {
      console.log(`  City ${city.name} already exists in database`);
    }
  }

  private getCityCoordinates(cityId: string): { lat: number; lng: number } {
    const coords: Record<string, { lat: number; lng: number }> = {
      // Phase 1
      nyc: { lat: 40.7128, lng: -74.006 },
      la: { lat: 34.0522, lng: -118.2437 },
      chicago: { lat: 41.8781, lng: -87.6298 },
      sf: { lat: 37.7749, lng: -122.4194 },
      miami: { lat: 25.7617, lng: -80.1918 },
      // Phase 2
      houston: { lat: 29.7604, lng: -95.3698 },
      austin: { lat: 30.2672, lng: -97.7431 },
      vegas: { lat: 36.1699, lng: -115.1398 },
      philly: { lat: 39.9526, lng: -75.1652 },
      seattle: { lat: 47.6062, lng: -122.3321 },
      // Phase 3
      nola: { lat: 29.9511, lng: -90.0715 },
      boston: { lat: 42.3601, lng: -71.0589 },
      dc: { lat: 38.9072, lng: -77.0369 },
      nashville: { lat: 36.1627, lng: -86.7816 },
      portland: { lat: 45.5152, lng: -122.6784 },
    };
    return coords[cityId] || { lat: 0, lng: 0 };
  }

  private async discoverVenuesByCategory(
    city: { id: string; name: string },
    category: string
  ): Promise<void> {
    console.log(`\n  📍 Discovering ${category} in ${city.name}...`);

    try {
      const result = await this.perplexica.discoverVenues(city.name, {
        category,
        limit: 30,
      });

      console.log(`     Found ${result.venues.length} venues`);

      for (const venue of result.venues) {
        await this.saveVenue({
          ...venue,
          city_id: city.id,
          category: this.normalizeCategory(category),
          source: 'perplexica',
        });
      }
    } catch (error: any) {
      console.log(`     ⚠️  Error: ${error.message}`);
    }
  }

  private async discoverVenuesBySearch(
    city: { id: string; name: string },
    category: string,
    searchTerm: string
  ): Promise<void> {
    const query = `${searchTerm} ${city.name} 2024`;
    console.log(`  🔍 Searching: "${query}"`);

    try {
      const result = await this.perplexica.searchVenues(query);
      
      // Parse venues from response
      const venues = this.parseVenuesFromText(result.message, city.id, category);
      console.log(`     Extracted ${venues.length} venues`);

      for (const venue of venues) {
        await this.saveVenue(venue);
      }

      // Also check sources for additional venue mentions
      if (result.sources) {
        for (const source of result.sources.slice(0, 5)) {
          // Could scrape these URLs for more detailed info
          console.log(`     Source: ${source.title?.substring(0, 50)}...`);
        }
      }
    } catch (error: any) {
      console.log(`     ⚠️  Search error: ${error.message}`);
    }
  }

  private parseVenuesFromText(text: string, cityId: string, category: string): VenueData[] {
    const venues: VenueData[] = [];
    
    // Common patterns for venue names in lists
    const patterns = [
      // Numbered lists: "1. Venue Name"
      /^\d+[\.\)]\s+([A-Z][^,\n]{2,50})(?:[,\s]|$)/gm,
      // Bold/emphasized: "**Venue Name**" or "*Venue Name*"
      /\*\*([A-Z][^*]{2,50})\*\*/g,
      /\*([A-Z][^*]{2,50})\*/g,
      // Venue Name: description
      /^([A-Z][A-Za-z\s&']{2,40}):\s/gm,
      // "At Venue Name" pattern
      /(?:at|visit|try)\s+([A-Z][A-Za-z\s&']{2,40})(?:[,\.]|$)/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1].trim();
        
        // Filter out common non-venue words
        if (this.isLikelyVenueName(name)) {
          const exists = venues.some(v => 
            v.name.toLowerCase() === name.toLowerCase()
          );
          if (!exists) {
            venues.push({
              name,
              city_id: cityId,
              category: this.normalizeCategory(category),
              source: 'perplexica-extract',
            });
          }
        }
      }
    }

    return venues;
  }

  private isLikelyVenueName(name: string): boolean {
    const nonVenueWords = [
      'the best', 'top', 'great', 'amazing', 'perfect', 'ideal',
      'restaurants', 'bars', 'cafes', 'best of', 'guide to',
      'new york', 'los angeles', 'chicago', 'miami', 'las vegas',
      'downtown', 'midtown', 'uptown', 'neighborhood',
    ];
    
    const lowerName = name.toLowerCase();
    
    if (name.length < 3 || name.length > 50) return false;
    if (nonVenueWords.some(w => lowerName.includes(w))) return false;
    if (!/[a-zA-Z]/.test(name)) return false;
    if (/^\d+$/.test(name)) return false;
    
    return true;
  }

  private normalizeCategory(category: string): string {
    const mapping: Record<string, string> = {
      'restaurants': 'restaurant',
      'bars': 'bar',
      'cafes': 'cafe',
      'coffee shops': 'cafe',
      'cocktail bars': 'bar',
      'wine bars': 'bar',
      'breweries': 'bar',
      'bakeries': 'cafe',
      'food halls': 'restaurant',
    };
    return mapping[category.toLowerCase()] || category.toLowerCase();
  }

  private async saveVenue(venue: VenueData): Promise<boolean> {
    try {
      // Skip if name is too short or invalid
      if (!venue.name || venue.name.length < 2) {
        return false;
      }

      // Check for duplicates
      const existing = await pool.query(
        `SELECT id FROM venues 
         WHERE LOWER(TRIM(name)) = LOWER($1) AND city_id = $2 
         LIMIT 1`,
        [venue.name.trim(), venue.city_id]
      );

      if (existing.rows.length > 0) {
        return false; // Already exists
      }

      if (this.dryRun) {
        console.log(`     [DRY] Would save: ${venue.name}`);
        this.venueCount++;
        return true;
      }

      const id = `venue_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      
      await pool.query(
        `INSERT INTO venues (
          id, name, city_id, category, cuisine, price_range,
          description, website, phone, image_url, rating,
          coordinates, features, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
        )`,
        [
          id,
          venue.name.trim(),
          venue.city_id,
          venue.category || 'restaurant',
          venue.cuisine,
          venue.price_range || '$$',
          venue.description,
          venue.website,
          venue.phone,
          venue.image_url,
          venue.rating,
          JSON.stringify(venue.coordinates || this.getCityCoordinates(venue.city_id)),
          JSON.stringify(venue.features || []),
        ]
      );

      this.venueCount++;
      console.log(`     ✅ Saved: ${venue.name}`);
      return true;
    } catch (error: any) {
      this.failedCount++;
      console.log(`     ❌ Failed to save ${venue.name}: ${error.message}`);
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: { dryRun?: boolean; city?: string; phase?: number } = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') {
    options.dryRun = true;
  } else if (args[i] === '--city' && args[i + 1]) {
    options.city = args[i + 1];
    i++;
  } else if (args[i] === '--phase' && args[i + 1]) {
    options.phase = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Usage: npx ts-node scripts/seed-real-venues.ts [options]

Options:
  --dry-run         Run without saving to database
  --city <id>       Process only specified city
  --phase <1|2|3>   Process only cities in specified phase
  --help, -h        Show this help message

Available Cities:
  Phase 1: nyc, la, chicago, sf, miami
  Phase 2: houston, austin, vegas, philly, seattle
  Phase 3: nola, boston, dc, nashville, portland

Examples:
  npx ts-node scripts/seed-real-venues.ts --phase 1
  npx ts-node scripts/seed-real-venues.ts --city nyc --dry-run
  npx ts-node scripts/seed-real-venues.ts
`);
    process.exit(0);
  }
}

// Run the seeder
const seeder = new RealVenueSeeder(options);
seeder.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

