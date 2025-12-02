#!/usr/bin/env ts-node
/**
 * Scrape Venues to JSON (Step 1 of 2)
 * 
 * Fetches venue data from Google Places API and saves to JSON files.
 * Run this locally, then transfer JSON to EC2 for import.
 * 
 * Output: data/venues/{city}-{category}.json
 * 
 * Usage:
 *   npx ts-node scripts/scrape-venues-to-json.ts --city nyc --category restaurant
 *   npx ts-node scripts/scrape-venues-to-json.ts --all-cities --all-categories
 *   npx ts-node scripts/scrape-venues-to-json.ts --city nyc --target 50
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inline the Google Places logic to avoid database dependency
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const BASE_URL = 'https://places.googleapis.com/v1';

// Types
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

interface VenueData {
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
  google_place_id: string;
  opening_hours?: string[];
  neighborhood?: string;
  google_maps_url?: string;
}

interface QualityFilters {
  minRating: number;
  minReviews: number;
  requirePhotos: boolean;
  requireContact: boolean;
}

const DEFAULT_FILTERS: QualityFilters = {
  minRating: 4.2,
  minReviews: 100,
  requirePhotos: true,
  requireContact: true,
};

// Cities
const CITIES = ['nyc', 'la', 'chicago', 'miami', 'vegas'] as const;
type CityId = typeof CITIES[number];

const CITY_INFO: Record<CityId, { lat: number; lng: number; name: string; state: string }> = {
  nyc: { lat: 40.7580, lng: -73.9855, name: 'New York City', state: 'NY' },
  la: { lat: 34.0522, lng: -118.2437, name: 'Los Angeles', state: 'CA' },
  chicago: { lat: 41.8827, lng: -87.6233, name: 'Chicago', state: 'IL' },
  miami: { lat: 25.7617, lng: -80.1918, name: 'Miami', state: 'FL' },
  vegas: { lat: 36.1147, lng: -115.1728, name: 'Las Vegas', state: 'NV' },
};

const NEIGHBORHOODS: Record<CityId, string[]> = {
  nyc: ['Manhattan', 'Williamsburg Brooklyn', 'SoHo', 'West Village', 'East Village', 'Chelsea', 'Tribeca', 'DUMBO Brooklyn', 'Greenpoint Brooklyn'],
  la: ['Silver Lake', 'Los Feliz', 'Venice', 'Santa Monica', 'West Hollywood', 'Downtown LA', 'Arts District', 'Culver City'],
  chicago: ['Wicker Park', 'Logan Square', 'Pilsen', 'West Loop', 'River North', 'Lincoln Park', 'Fulton Market'],
  miami: ['Wynwood', 'Design District', 'South Beach', 'Brickell', 'Little Havana', 'Coconut Grove', 'Coral Gables'],
  vegas: ['The Strip', 'Downtown Fremont', 'Arts District', 'Summerlin', 'Chinatown'],
};

// Search tiers
const SEARCH_TIERS = {
  tier1: {
    restaurant: ['Michelin star restaurant', 'James Beard award restaurant', 'best new restaurant 2024'],
    bar: ['best cocktail bar award', "World's 50 Best Bars", 'award winning speakeasy'],
    cafe: ['best coffee roaster award', 'specialty coffee award'],
  },
  tier2: {
    restaurant: ['Eater 38 restaurant', 'Infatuation best restaurant', 'TimeOut best restaurant'],
    bar: ['Eater best bars', 'best speakeasy', 'best rooftop bar'],
    cafe: ['best specialty coffee', 'best coffee shop'],
  },
  tier3: {
    restaurant: ['fine dining', 'tasting menu', 'omakase', 'farm to table', 'best Italian', 'best Japanese', 'best Mexican', 'best steakhouse', 'best brunch'],
    bar: ['craft cocktail bar', 'speakeasy', 'rooftop bar', 'wine bar', 'jazz bar', 'whiskey bar'],
    cafe: ['specialty coffee roaster', 'third wave coffee', 'artisan bakery'],
  },
};

const CATEGORIES = ['restaurant', 'bar', 'cafe'] as const;
type Category = typeof CATEGORIES[number];

// API functions
let requestCount = 0;
let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const minInterval = 200;
  if (now - lastRequestTime < minInterval) {
    await delay(minInterval - (now - lastRequestTime));
  }
  lastRequestTime = Date.now();
  requestCount++;
}

async function textSearch(query: string, location: { lat: number; lng: number }): Promise<GooglePlace[]> {
  if (!GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY not set');

  await rateLimit();

  const fieldMask = [
    'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
    'places.types', 'places.rating', 'places.userRatingCount', 'places.priceLevel',
    'places.websiteUri', 'places.nationalPhoneNumber', 'places.regularOpeningHours',
    'places.photos', 'places.editorialSummary', 'places.googleMapsUri', 'places.businessStatus',
  ].join(',');

  const response = await fetch(`${BASE_URL}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
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

function meetsQuality(place: GooglePlace, filters: QualityFilters): boolean {
  if (!place.rating || place.rating < filters.minRating) return false;
  if (!place.userRatingCount || place.userRatingCount < filters.minReviews) return false;
  if (filters.requirePhotos && (!place.photos || place.photos.length === 0)) return false;
  if (filters.requireContact && !place.websiteUri && !place.nationalPhoneNumber) return false;
  if (place.businessStatus === 'CLOSED_PERMANENTLY') return false;
  return true;
}

function convertToVenue(place: GooglePlace, cityId: string, neighborhood?: string): VenueData {
  const priceMap: Record<string, string> = {
    'PRICE_LEVEL_INEXPENSIVE': '$',
    'PRICE_LEVEL_MODERATE': '$$',
    'PRICE_LEVEL_EXPENSIVE': '$$$',
    'PRICE_LEVEL_VERY_EXPENSIVE': '$$$$',
  };

  let category = 'restaurant';
  const types = place.types || [];
  if (types.includes('bar') || types.includes('night_club')) category = 'bar';
  else if (types.includes('cafe') || types.includes('coffee_shop')) category = 'cafe';

  const cuisineTypes = types.filter(t => t.includes('restaurant') && t !== 'restaurant');
  const cuisine = cuisineTypes[0]?.replace('_restaurant', '').replace(/_/g, ' ');

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
    image_url: place.photos?.[0] ? `${BASE_URL}/${place.photos[0].name}/media?maxWidthPx=800&key=${GOOGLE_MAPS_API_KEY}` : undefined,
    rating: place.rating,
    review_count: place.userRatingCount,
    coordinates: { lat: place.location.latitude, lng: place.location.longitude },
    features: types.filter(t => !t.includes('establishment')),
    google_place_id: place.id,
    opening_hours: place.regularOpeningHours?.weekdayDescriptions,
    neighborhood,
    google_maps_url: place.googleMapsUri,
  };
}

async function scrapeCity(
  cityId: CityId,
  category: Category,
  targetCount: number,
  filters: QualityFilters
): Promise<VenueData[]> {
  const city = CITY_INFO[cityId];
  const venues: VenueData[] = [];
  const seenIds = new Set<string>();

  const addVenues = (places: GooglePlace[], hood?: string) => {
    for (const place of places) {
      if (seenIds.has(place.id)) continue;
      if (!meetsQuality(place, filters)) continue;
      seenIds.add(place.id);
      venues.push(convertToVenue(place, cityId, hood));
    }
  };

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🏙️  ${city.name} - ${category}s (target: ${targetCount})`);
  console.log('─'.repeat(60));

  // Tier 1: Awards
  const tier1 = SEARCH_TIERS.tier1[category] || [];
  console.log(`\n📍 Tier 1: Award searches (${tier1.length} queries)`);
  for (const query of tier1) {
    if (venues.length >= targetCount) break;
    const fullQuery = `${query} ${city.name}`;
    console.log(`  🔍 "${fullQuery}"`);
    try {
      const places = await textSearch(fullQuery, city);
      const before = venues.length;
      addVenues(places);
      console.log(`     ${places.length} results, kept ${venues.length - before} (total: ${venues.length})`);
    } catch (e: any) {
      console.log(`     ⚠️ ${e.message}`);
    }
  }

  // Tier 2: Curated
  if (venues.length < targetCount) {
    const tier2 = SEARCH_TIERS.tier2[category] || [];
    console.log(`\n📍 Tier 2: Curated list searches (${tier2.length} queries)`);
    for (const query of tier2) {
      if (venues.length >= targetCount) break;
      const fullQuery = `${query} ${city.name}`;
      console.log(`  🔍 "${fullQuery}"`);
      try {
        const places = await textSearch(fullQuery, city);
        const before = venues.length;
        addVenues(places);
        console.log(`     ${places.length} results, kept ${venues.length - before} (total: ${venues.length})`);
      } catch (e: any) {
        console.log(`     ⚠️ ${e.message}`);
      }
    }
  }

  // Tier 3: Types
  if (venues.length < targetCount) {
    const tier3 = SEARCH_TIERS.tier3[category] || [];
    console.log(`\n📍 Tier 3: Venue type searches (${tier3.length} queries)`);
    for (const query of tier3) {
      if (venues.length >= targetCount) break;
      const fullQuery = `best ${query} ${city.name}`;
      console.log(`  🔍 "${fullQuery}"`);
      try {
        const places = await textSearch(fullQuery, city);
        const before = venues.length;
        addVenues(places);
        console.log(`     ${places.length} results, kept ${venues.length - before} (total: ${venues.length})`);
      } catch (e: any) {
        console.log(`     ⚠️ ${e.message}`);
      }
    }
  }

  // Tier 4: Neighborhoods
  if (venues.length < targetCount) {
    const hoods = NEIGHBORHOODS[cityId] || [];
    console.log(`\n📍 Tier 4: Neighborhood searches (${hoods.length} neighborhoods)`);
    for (const hood of hoods) {
      if (venues.length >= targetCount) break;
      const query = `best ${category} ${hood}`;
      console.log(`  🔍 "${query}"`);
      try {
        const places = await textSearch(query, city);
        const before = venues.length;
        addVenues(places, hood);
        console.log(`     ${places.length} results, kept ${venues.length - before} (total: ${venues.length})`);
      } catch (e: any) {
        console.log(`     ⚠️ ${e.message}`);
      }
    }
  }

  console.log(`\n✅ Total: ${venues.length} quality ${category}s in ${city.name}`);
  return venues.slice(0, targetCount);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main
async function main() {
  const args = process.argv.slice(2);
  
  let cities: CityId[] = [];
  let categories: Category[] = [];
  let target = 200;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--city':
        if (CITIES.includes(args[i + 1] as CityId)) cities.push(args[i + 1] as CityId);
        i++;
        break;
      case '--all-cities':
        cities = [...CITIES];
        break;
      case '--category':
        if (CATEGORIES.includes(args[i + 1] as Category)) categories.push(args[i + 1] as Category);
        i++;
        break;
      case '--all-categories':
        categories = [...CATEGORIES];
        break;
      case '--target':
        target = parseInt(args[i + 1], 10);
        i++;
        break;
      case '--help':
        console.log(`
Scrape venues to JSON files (no database needed)

Usage:
  npx ts-node scripts/scrape-venues-to-json.ts [options]

Options:
  --city <id>         City to scrape (nyc, la, chicago, miami, vegas)
  --all-cities        Scrape all 5 cities
  --category <cat>    Category (restaurant, bar, cafe)
  --all-categories    Scrape all categories
  --target <n>        Target venues per city/category (default: 200)

Output:
  data/venues/{city}-{category}.json

Examples:
  npx ts-node scripts/scrape-venues-to-json.ts --city nyc --category restaurant
  npx ts-node scripts/scrape-venues-to-json.ts --all-cities --all-categories --target 100
`);
        process.exit(0);
    }
  }

  // Defaults
  if (cities.length === 0) cities = ['nyc'];
  if (categories.length === 0) categories = ['restaurant'];

  if (!GOOGLE_MAPS_API_KEY) {
    console.error('❌ GOOGLE_MAPS_API_KEY not set');
    process.exit(1);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('🗺️  VENUE SCRAPER → JSON');
  console.log('═'.repeat(60));
  console.log(`Cities:     ${cities.join(', ')}`);
  console.log(`Categories: ${categories.join(', ')}`);
  console.log(`Target:     ${target} per city/category`);
  console.log(`Filters:    ≥${DEFAULT_FILTERS.minRating}⭐, ≥${DEFAULT_FILTERS.minReviews} reviews`);
  console.log('═'.repeat(60));

  // Ensure output directory
  const outDir = path.join(__dirname, '../data/venues');
  fs.mkdirSync(outDir, { recursive: true });

  const allResults: Record<string, number> = {};

  for (const cityId of cities) {
    for (const category of categories) {
      const venues = await scrapeCity(cityId, category, target, DEFAULT_FILTERS);
      
      const filename = `${cityId}-${category}.json`;
      const filepath = path.join(outDir, filename);
      
      fs.writeFileSync(filepath, JSON.stringify(venues, null, 2));
      console.log(`\n💾 Saved: ${filepath} (${venues.length} venues)`);
      
      allResults[`${cityId}-${category}`] = venues.length;
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 SCRAPING COMPLETE');
  console.log('═'.repeat(60));
  console.log(`API Requests: ${requestCount}`);
  console.log('\nFiles created:');
  for (const [key, count] of Object.entries(allResults)) {
    console.log(`  data/venues/${key}.json: ${count} venues`);
  }
  console.log('\nNext steps:');
  console.log('  1. Review JSON files (optional)');
  console.log('  2. Copy to EC2: scp -r data/venues/ ec2-user@<EC2_IP>:~/localist-backend/data/');
  console.log('  3. On EC2: npx ts-node scripts/import-venues-from-json.ts');
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

