/**
 * MVP Venue Scraper
 *
 * Scrapes venues from Google Places API for the 5 MVP cities:
 * - New York City
 * - Los Angeles
 * - Chicago
 * - Miami
 * - Las Vegas
 *
 * Target: ~100 venues per city across restaurant, bar, and cafe categories
 *
 * Usage: npx ts-node scripts/scrape-mvp-venues.ts
 */

import axios from 'axios';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

// Configuration
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgresstrongpassword123@localhost:5432/localist';

// Rate limiting - be respectful to Google's API
const DELAY_BETWEEN_REQUESTS_MS = 200;
const DELAY_BETWEEN_PAGES_MS = 2000;

// Types
interface GooglePlaceResult {
  place_id: string;
  name: string;
  vicinity: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  rating?: number;
  price_level?: number;
  user_ratings_total?: number;
  types: string[];
  photos?: Array<{
    photo_reference: string;
    height: number;
    width: number;
  }>;
  opening_hours?: {
    open_now?: boolean;
  };
  business_status?: string;
}

interface PlaceDetails {
  formatted_phone_number?: string;
  website?: string;
  opening_hours?: {
    weekday_text?: string[];
  };
  editorial_summary?: {
    overview?: string;
  };
}

interface City {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

// MVP Cities with their coordinates
const MVP_CITIES: City[] = [
  { id: 'nyc', name: 'New York City', lat: 40.7128, lng: -74.0060 },
  { id: 'la', name: 'Los Angeles', lat: 34.0522, lng: -118.2437 },
  { id: 'chicago', name: 'Chicago', lat: 41.8781, lng: -87.6298 },
  { id: 'miami', name: 'Miami', lat: 25.7617, lng: -80.1918 },
  { id: 'vegas', name: 'Las Vegas', lat: 36.1699, lng: -115.1398 },
];

// Categories to scrape (Google Places types)
const CATEGORIES = [
  { type: 'restaurant', label: 'Restaurant' },
  { type: 'bar', label: 'Bar' },
  { type: 'cafe', label: 'Cafe' },
  { type: 'night_club', label: 'Nightclub' },
];

// Database connection
let pool: Pool;

async function initDatabase(): Promise<void> {
  pool = new Pool({
    connectionString: DATABASE_URL,
  });

  // Test connection
  const client = await pool.connect();
  console.log('Connected to database');
  client.release();
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchNearbyPlaces(
  lat: number,
  lng: number,
  type: string,
  pageToken?: string
): Promise<{ results: GooglePlaceResult[]; nextPageToken?: string }> {
  const baseUrl = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

  const params: any = {
    key: GOOGLE_API_KEY,
    location: `${lat},${lng}`,
    radius: 8000, // 8km radius for good city coverage
    type: type,
  };

  if (pageToken) {
    params.pagetoken = pageToken;
  }

  try {
    const response = await axios.get(baseUrl, { params });

    if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
      console.error(`Google API error: ${response.data.status} - ${response.data.error_message || ''}`);
      return { results: [] };
    }

    return {
      results: response.data.results || [],
      nextPageToken: response.data.next_page_token,
    };
  } catch (error: any) {
    console.error(`Failed to search places: ${error.message}`);
    return { results: [] };
  }
}

async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const url = 'https://maps.googleapis.com/maps/api/place/details/json';

  try {
    const response = await axios.get(url, {
      params: {
        key: GOOGLE_API_KEY,
        place_id: placeId,
        fields: 'formatted_phone_number,website,opening_hours,editorial_summary',
      },
    });

    if (response.data.status === 'OK') {
      return response.data.result;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function getPhotoUrl(photoReference: string): string {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoReference}&key=${GOOGLE_API_KEY}`;
}

function mapPriceLevel(level?: number): string {
  if (!level) return '$$';
  const priceMap: { [key: number]: string } = {
    0: '$',
    1: '$',
    2: '$$',
    3: '$$$',
    4: '$$$$',
  };
  return priceMap[level] || '$$';
}

function extractCuisineFromTypes(types: string[]): string {
  const cuisineTypes: { [key: string]: string } = {
    'italian_restaurant': 'Italian',
    'japanese_restaurant': 'Japanese',
    'chinese_restaurant': 'Chinese',
    'mexican_restaurant': 'Mexican',
    'thai_restaurant': 'Thai',
    'indian_restaurant': 'Indian',
    'french_restaurant': 'French',
    'korean_restaurant': 'Korean',
    'vietnamese_restaurant': 'Vietnamese',
    'american_restaurant': 'American',
    'mediterranean_restaurant': 'Mediterranean',
    'greek_restaurant': 'Greek',
    'spanish_restaurant': 'Spanish',
    'seafood_restaurant': 'Seafood',
    'steak_house': 'Steakhouse',
    'pizza_restaurant': 'Pizza',
    'sushi_restaurant': 'Japanese',
    'ramen_restaurant': 'Japanese',
    'bbq_restaurant': 'BBQ',
    'vegetarian_restaurant': 'Vegetarian',
    'vegan_restaurant': 'Vegan',
    'brunch_restaurant': 'Brunch',
  };

  for (const type of types) {
    if (cuisineTypes[type]) {
      return cuisineTypes[type];
    }
  }

  // Fallback based on main type
  if (types.includes('bar')) return 'Bar & Grill';
  if (types.includes('cafe')) return 'Cafe';
  if (types.includes('bakery')) return 'Bakery';

  return 'American'; // Default
}

function parseHours(weekdayText?: string[]): any {
  if (!weekdayText) return {};

  const hours: any = {};
  const dayMap: { [key: string]: string } = {
    'Monday': 'monday',
    'Tuesday': 'tuesday',
    'Wednesday': 'wednesday',
    'Thursday': 'thursday',
    'Friday': 'friday',
    'Saturday': 'saturday',
    'Sunday': 'sunday',
  };

  for (const text of weekdayText) {
    const match = text.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, day, hoursStr] = match;
      const dayKey = dayMap[day];
      if (dayKey) {
        hours[dayKey] = hoursStr.toLowerCase() === 'closed' ? 'Closed' : hoursStr;
      }
    }
  }

  return hours;
}

async function saveVenue(
  place: GooglePlaceResult,
  cityId: string,
  category: string,
  details?: PlaceDetails | null
): Promise<boolean> {
  // Check if venue already exists (by name + city or coordinates)
  const existingCheck = await pool.query(
    `SELECT id FROM venues WHERE city_id = $1 AND (
      LOWER(name) = LOWER($2) OR
      (coordinates IS NOT NULL AND
       ABS((coordinates->>'lat')::float - $3) < 0.0001 AND
       ABS((coordinates->>'lng')::float - $4) < 0.0001)
    )`,
    [cityId, place.name, place.geometry.location.lat, place.geometry.location.lng]
  );

  if (existingCheck.rows.length > 0) {
    // Update existing venue with any new info
    return false;
  }

  const id = uuidv4();
  const imageUrl = place.photos?.[0]
    ? getPhotoUrl(place.photos[0].photo_reference)
    : null;

  const cuisine = extractCuisineFromTypes(place.types);
  const priceRange = mapPriceLevel(place.price_level);
  const hours = parseHours(details?.opening_hours?.weekday_text);

  // Generate a description
  const description = details?.editorial_summary?.overview ||
    `Popular ${category.toLowerCase()} in ${cityId === 'nyc' ? 'New York City' : cityId === 'la' ? 'Los Angeles' : cityId === 'vegas' ? 'Las Vegas' : cityId.charAt(0).toUpperCase() + cityId.slice(1)}. ${place.rating ? `Rated ${place.rating} stars.` : ''}`;

  try {
    await pool.query(
      `INSERT INTO venues (
        id, name, city_id, category, cuisine, price_range, description,
        address, phone, website, image_url, rating, coordinates, hours, features
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id,
        place.name,
        cityId,
        category,
        cuisine,
        priceRange,
        description,
        place.vicinity,
        details?.formatted_phone_number || null,
        details?.website || null,
        imageUrl,
        place.rating || null,
        JSON.stringify({
          lat: place.geometry.location.lat,
          lng: place.geometry.location.lng,
        }),
        JSON.stringify(hours),
        JSON.stringify([]),
      ]
    );
    return true;
  } catch (error: any) {
    if (error.code !== '23505') { // Ignore unique constraint violations
      console.error(`Failed to save venue ${place.name}: ${error.message}`);
    }
    return false;
  }
}

async function scrapeCity(city: City): Promise<number> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Scraping ${city.name}...`);
  console.log(`${'='.repeat(60)}`);

  let totalVenues = 0;

  for (const category of CATEGORIES) {
    console.log(`\n  Category: ${category.label}`);
    let categoryVenues = 0;
    let pageToken: string | undefined;
    let pageNum = 1;

    do {
      console.log(`    Page ${pageNum}...`);

      const { results, nextPageToken } = await searchNearbyPlaces(
        city.lat,
        city.lng,
        category.type,
        pageToken
      );

      for (const place of results) {
        // Skip places that are permanently closed
        if (place.business_status === 'CLOSED_PERMANENTLY') {
          continue;
        }

        // Get details for top-rated places (to save API calls)
        let details: PlaceDetails | null = null;
        if (place.rating && place.rating >= 4.0) {
          await delay(DELAY_BETWEEN_REQUESTS_MS);
          details = await getPlaceDetails(place.place_id);
        }

        const saved = await saveVenue(place, city.id, category.label, details);
        if (saved) {
          categoryVenues++;
          totalVenues++;
        }

        await delay(DELAY_BETWEEN_REQUESTS_MS);
      }

      pageToken = nextPageToken;
      pageNum++;

      // Google returns max 60 results (3 pages of 20)
      if (pageToken && pageNum <= 3) {
        console.log(`    Waiting for next page token...`);
        await delay(DELAY_BETWEEN_PAGES_MS);
      }

    } while (pageToken && pageNum <= 3);

    console.log(`    Added ${categoryVenues} ${category.label}s`);
  }

  console.log(`\n  Total venues added for ${city.name}: ${totalVenues}`);
  return totalVenues;
}

async function main(): Promise<void> {
  console.log('MVP Venue Scraper');
  console.log('=================\n');

  if (!GOOGLE_API_KEY) {
    console.error('ERROR: GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY not set');
    console.error('Please set the environment variable and try again.');
    process.exit(1);
  }

  console.log(`Using API key: ${GOOGLE_API_KEY.substring(0, 10)}...`);

  await initDatabase();

  // Check current venue count
  const countBefore = await pool.query('SELECT COUNT(*) as count FROM venues');
  console.log(`\nCurrent venue count: ${countBefore.rows[0].count}`);

  let grandTotal = 0;

  for (const city of MVP_CITIES) {
    const count = await scrapeCity(city);
    grandTotal += count;

    // Pause between cities
    console.log('\nPausing before next city...');
    await delay(5000);
  }

  // Final summary
  const countAfter = await pool.query('SELECT COUNT(*) as count FROM venues');

  console.log('\n' + '='.repeat(60));
  console.log('SCRAPING COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total new venues added: ${grandTotal}`);
  console.log(`Total venues in database: ${countAfter.rows[0].count}`);

  // Breakdown by city
  const breakdown = await pool.query(`
    SELECT c.name, COUNT(v.id) as count
    FROM cities c
    LEFT JOIN venues v ON c.id = v.city_id
    WHERE c.id IN ('nyc', 'la', 'chicago', 'miami', 'vegas')
    GROUP BY c.id, c.name
    ORDER BY c.name
  `);

  console.log('\nVenues by city:');
  for (const row of breakdown.rows) {
    console.log(`  ${row.name}: ${row.count}`);
  }

  await pool.end();
  console.log('\nDone!');
}

main().catch(console.error);
