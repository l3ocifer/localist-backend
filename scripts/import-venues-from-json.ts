#!/usr/bin/env ts-node
/**
 * Import Venues from JSON (Step 2 of 2)
 * 
 * Reads JSON files created by scrape-venues-to-json.ts and imports to PostgreSQL.
 * Run this on EC2 after transferring JSON files.
 * 
 * Input: data/venues/{city}-{category}.json
 * 
 * Usage:
 *   npx ts-node scripts/import-venues-from-json.ts
 *   npx ts-node scripts/import-venues-from-json.ts --dry-run
 *   npx ts-node scripts/import-venues-from-json.ts --file data/venues/nyc-restaurant.json
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env.local'), override: true });
dotenv.config({ path: path.join(__dirname, '../.env'), override: true });

import pool from '../src/config/database';

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

const CITY_DETAILS: Record<string, { name: string; state: string; lat: number; lng: number }> = {
  nyc: { name: 'New York City', state: 'NY', lat: 40.7128, lng: -74.006 },
  la: { name: 'Los Angeles', state: 'CA', lat: 34.0522, lng: -118.2437 },
  chicago: { name: 'Chicago', state: 'IL', lat: 41.8781, lng: -87.6298 },
  miami: { name: 'Miami', state: 'FL', lat: 25.7617, lng: -80.1918 },
  vegas: { name: 'Las Vegas', state: 'NV', lat: 36.1699, lng: -115.1398 },
};

class VenueImporter {
  private dryRun: boolean;
  private stats = {
    imported: 0,
    duplicates: 0,
    errors: 0,
  };

  constructor(dryRun: boolean) {
    this.dryRun = dryRun;
  }

  async run(files: string[]): Promise<void> {
    console.log('\n' + '═'.repeat(60));
    console.log('📥 VENUE IMPORTER (JSON → PostgreSQL)');
    console.log('═'.repeat(60));
    console.log(`Mode: ${this.dryRun ? '🔍 DRY RUN' : '💾 LIVE'}`);
    console.log(`Files: ${files.length}`);
    console.log('═'.repeat(60));

    // First ensure cities exist
    await this.ensureCitiesExist();

    // Process each file
    for (const file of files) {
      await this.importFile(file);
    }

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 IMPORT COMPLETE');
    console.log('═'.repeat(60));
    console.log(`Imported:   ${this.stats.imported}`);
    console.log(`Duplicates: ${this.stats.duplicates}`);
    console.log(`Errors:     ${this.stats.errors}`);
    if (this.dryRun) {
      console.log('\n⚠️  DRY RUN - No data was written');
    }
    console.log('═'.repeat(60) + '\n');

    await pool.end();
  }

  private async ensureCitiesExist(): Promise<void> {
    console.log('\n📍 Ensuring cities exist...');
    
    for (const [cityId, city] of Object.entries(CITY_DETAILS)) {
      const existing = await pool.query('SELECT id FROM cities WHERE id = $1', [cityId]);
      
      if (existing.rows.length === 0) {
        console.log(`  Creating: ${city.name}, ${city.state}`);
        
        if (!this.dryRun) {
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
      } else {
        console.log(`  Exists: ${city.name}`);
      }
    }
  }

  private async importFile(filepath: string): Promise<void> {
    console.log(`\n📂 Importing: ${path.basename(filepath)}`);
    
    if (!fs.existsSync(filepath)) {
      console.log(`   ❌ File not found: ${filepath}`);
      return;
    }

    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8')) as VenueData[];
    console.log(`   Found ${data.length} venues`);

    for (const venue of data) {
      await this.importVenue(venue);
    }
  }

  private async importVenue(venue: VenueData): Promise<void> {
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
        this.stats.duplicates++;
        return;
      }

      if (this.dryRun) {
        console.log(`   [DRY] ${venue.name} (${venue.rating}⭐)`);
        this.stats.imported++;
        return;
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

      this.stats.imported++;
      console.log(`   ✅ ${venue.name}`);

    } catch (error: any) {
      this.stats.errors++;
      console.log(`   ❌ ${venue.name}: ${error.message}`);
    }
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let specificFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--file':
        specificFile = args[i + 1];
        i++;
        break;
      case '--help':
        console.log(`
Import venues from JSON files to PostgreSQL

Usage:
  npx ts-node scripts/import-venues-from-json.ts [options]

Options:
  --dry-run        Preview without writing to database
  --file <path>    Import specific file only

Examples:
  npx ts-node scripts/import-venues-from-json.ts --dry-run
  npx ts-node scripts/import-venues-from-json.ts --file data/venues/nyc-restaurant.json
  npx ts-node scripts/import-venues-from-json.ts
`);
        process.exit(0);
    }
  }

  // Find JSON files
  let files: string[] = [];
  
  if (specificFile) {
    files = [specificFile];
  } else {
    const venueDir = path.join(__dirname, '../data/venues');
    if (fs.existsSync(venueDir)) {
      files = fs.readdirSync(venueDir)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(venueDir, f));
    }
  }

  if (files.length === 0) {
    console.error('❌ No JSON files found in data/venues/');
    console.log('Run scrape-venues-to-json.ts first to generate data.');
    process.exit(1);
  }

  const importer = new VenueImporter(dryRun);
  await importer.run(files);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

