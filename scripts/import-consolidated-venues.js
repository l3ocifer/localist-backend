#!/usr/bin/env node
/**
 * Import consolidated venues from JSON into the database
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function importVenues() {
  const venuesPath = process.argv[2] || '/app/data/venues/consolidated-all-venues.json';
  
  if (!fs.existsSync(venuesPath)) {
    console.error('Venues file not found:', venuesPath);
    process.exit(1);
  }
  
  const venues = JSON.parse(fs.readFileSync(venuesPath, 'utf8'));
  console.log('Total venues to import:', venues.length);
  
  let imported = 0, updated = 0, skipped = 0, errors = 0;
  
  // Get existing cities
  const citiesResult = await pool.query('SELECT id FROM cities');
  const validCities = new Set(citiesResult.rows.map(r => r.id));
  console.log('Valid cities in DB:', [...validCities].join(', '));
  
  for (const v of venues) {
    // Skip if city doesn't exist
    if (!validCities.has(v.city_id)) {
      skipped++;
      continue;
    }
    
    try {
      const result = await pool.query(
        `INSERT INTO venues (id, name, city_id, category, cuisine, price_range, description, address, phone, website, image_url, rating, coordinates)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           rating = EXCLUDED.rating,
           image_url = EXCLUDED.image_url
         RETURNING (xmax = 0) as inserted`,
        [
          v.id,
          v.name,
          v.city_id,
          v.category || 'restaurant',
          v.cuisine,
          v.price_range || '$$',
          v.description,
          v.address,
          v.phone,
          v.website,
          v.image_url,
          parseFloat(v.rating) || 4.0,
          JSON.stringify(v.coordinates || {})
        ]
      );
      
      if (result.rows[0].inserted) {
        imported++;
      } else {
        updated++;
      }
    } catch (e) {
      errors++;
      if (errors <= 5) {
        console.error('Error importing venue:', v.id, v.name, '-', e.message);
      }
    }
  }
  
  console.log('\n=== Import Summary ===');
  console.log('Imported:', imported);
  console.log('Updated:', updated);
  console.log('Skipped (invalid city):', skipped);
  console.log('Errors:', errors);
  
  const countResult = await pool.query('SELECT COUNT(*) FROM venues');
  console.log('Total venues in DB:', countResult.rows[0].count);
  
  await pool.end();
}

importVenues().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
