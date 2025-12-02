#!/usr/bin/env node
/**
 * Simple venue import script (no TypeScript, runs in production container)
 * Usage: node scripts/simple-import.js
 */

const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CITIES = [
  { id: 'nyc', name: 'New York City', state: 'NY', lat: 40.7128, lng: -74.006 },
  { id: 'la', name: 'Los Angeles', state: 'CA', lat: 34.0522, lng: -118.2437 },
  { id: 'chicago', name: 'Chicago', state: 'IL', lat: 41.8781, lng: -87.6298 },
  { id: 'miami', name: 'Miami', state: 'FL', lat: 25.7617, lng: -80.1918 },
  { id: 'vegas', name: 'Las Vegas', state: 'NV', lat: 36.1699, lng: -115.1398 },
];

async function run() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('📥 VENUE IMPORT (JSON → PostgreSQL)');
  console.log('══════════════════════════════════════════════════════════\n');

  // Ensure cities exist
  console.log('📍 Ensuring cities exist...');
  for (const city of CITIES) {
    await pool.query(
      `INSERT INTO cities (id, name, state, country, description, coordinates)
       VALUES ($1, $2, $3, 'USA', $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [city.id, city.name, city.state, `Discover the best food and drinks in ${city.name}`, JSON.stringify({ lat: city.lat, lng: city.lng })]
    );
  }
  console.log('   ✅ Cities ready\n');

  // Find JSON files
  const dir = '/app/data/venues';
  if (!fs.existsSync(dir)) {
    console.error('❌ Data directory not found:', dir);
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  console.log(`📂 Found ${files.length} files to import\n`);

  let total = 0, imported = 0, skipped = 0, errors = 0;

  for (const file of files) {
    const filepath = `${dir}/${file}`;
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    console.log(`   Processing ${file} (${data.length} venues)...`);

    for (const v of data) {
      total++;
      try {
        // Check for duplicate
        const existing = await pool.query(
          'SELECT id FROM venues WHERE google_place_id = $1 LIMIT 1',
          [v.google_place_id]
        );

        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        // Strip API key from image URL for security
        const imageUrl = v.image_url ? v.image_url.replace(/&key=[^&]+/, '').replace(/\?key=[^&]+&/, '?') : null;

        const id = `venue_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        
        // Features is a text[] array, not jsonb - format properly for PostgreSQL
        const features = Array.isArray(v.features) ? v.features : [];
        
        // Truncate long strings to fit database constraints
        const truncate = (str, len) => str && str.length > len ? str.substring(0, len - 3) + '...' : str;
        const description = truncate(v.description, 497);
        const address = truncate(v.address, 197);
        const name = truncate(v.name, 197);
        const website = truncate(v.website, 497);
        
        await pool.query(
          `INSERT INTO venues (
            id, name, address, city_id, category, cuisine, price_range,
            description, website, phone, image_url, rating, review_count,
            coordinates, features, google_place_id, neighborhood, source,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())`,
          [
            id, name, address, v.city_id, v.category, v.cuisine, v.price_range,
            description, website, v.phone, imageUrl, v.rating, v.review_count,
            JSON.stringify(v.coordinates), features,
            v.google_place_id, v.neighborhood, 'google_places'
          ]
        );
        imported++;
      } catch (err) {
        errors++;
        console.error(`      ❌ Failed: ${v.name} - ${err.message}`);
      }
    }
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('📊 IMPORT COMPLETE');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`   Total:    ${total}`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Skipped:  ${skipped} (duplicates)`);
  console.log(`   Errors:   ${errors}`);
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

