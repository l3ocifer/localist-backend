import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Pool, PoolClient } from 'pg';

// Helper to validate UUID format
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Map for tracking string ID -> UUID mappings
const userIdMap: Map<string, string> = new Map();

dotenv.config({ path: '../.env' });
dotenv.config({ path: '../.env.local', override: true });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'localist',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Resolve data path for both Docker (/app/data) and local development
function getDataPath(filename: string): string {
  const dockerPath = `/app/data/${filename}`;
  const localPath = path.join(__dirname, `../../data/${filename}`);

  if (fs.existsSync(dockerPath)) return dockerPath;
  if (fs.existsSync(localPath)) return localPath;

  throw new Error(`Seed data not found: tried ${dockerPath} and ${localPath}`);
}

interface SeedData {
  cities: any[];
  neighborhoods?: any[];
  venues: any[];
  lists: any[];
  list_venues?: any[];
  users: any[];
  user_lists?: any[];
  saved_venues?: any[];
}

async function seed() {
  console.log('🌱 Starting database seeding...');

  // IMPORTANT: Get a dedicated client for the transaction
  // pool.query() uses different connections, breaking transactions!
  const client: PoolClient = await pool.connect();

  try {
    // Try basic seed data (known good format), fall back to comprehensive
    let seedDataPath: string;
    try {
      seedDataPath = getDataPath('seed-data.json');
      console.log('📝 Using basic seed data...');
    } catch {
      seedDataPath = getDataPath('comprehensive-seed-data.json');
      console.log('📝 Using comprehensive seed data...');
    }
    console.log(`📂 Found seed data at: ${seedDataPath}`);
    const seedData: SeedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));

    await client.query('BEGIN');

    // Ensure schema is compatible (migrations may not have run)
    console.log('🔧 Ensuring schema compatibility...');
    const schemaFixes = [
      // Increase column sizes to handle all our data
      "ALTER TABLE lists ALTER COLUMN id TYPE VARCHAR(250)",
      "ALTER TABLE list_venues ALTER COLUMN list_id TYPE VARCHAR(250)",
      "ALTER TABLE venues ALTER COLUMN phone TYPE VARCHAR(50)",
      "ALTER TABLE venues ALTER COLUMN price_range TYPE VARCHAR(20)",
      "ALTER TABLE venues ALTER COLUMN image_url TYPE TEXT",
      "ALTER TABLE venues ALTER COLUMN website TYPE TEXT",
      // Add category_type column to lists if missing
      "ALTER TABLE lists ADD COLUMN IF NOT EXISTS category_type VARCHAR(50)",
      // Add venue_count column to lists if missing
      "ALTER TABLE lists ADD COLUMN IF NOT EXISTS venue_count INTEGER DEFAULT 0",
      // Convert features to JSONB if it's still text[]
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='venues' AND column_name='features' AND data_type='ARRAY') THEN
          ALTER TABLE venues ALTER COLUMN features DROP DEFAULT;
          ALTER TABLE venues ALTER COLUMN features TYPE JSONB USING COALESCE(to_jsonb(features), '[]'::jsonb);
          ALTER TABLE venues ALTER COLUMN features SET DEFAULT '[]'::jsonb;
        END IF;
       END $$`
    ];
    for (const fix of schemaFixes) {
      try {
        await client.query(fix);
      } catch (e: any) {
        // Ignore errors (column may already be correct type)
        if (!e.message?.includes('already')) {
          console.log(`   ⚠️ Schema fix skipped: ${e.message?.substring(0, 50)}`);
        }
      }
    }
    console.log('   ✅ Schema compatibility ensured');

    // Clear existing data using TRUNCATE CASCADE to handle foreign keys
    console.log('🧹 Clearing existing data...');
    const safeTruncate = async (table: string) => {
      try { 
        await client.query(`TRUNCATE TABLE ${table} CASCADE`); 
        console.log(`   ✅ Truncated ${table}`);
      } catch (e: any) { 
        if (e.code === '42P01') {
          console.log(`   ⚠️ Table ${table} not found, skipping...`);
        } else {
          throw e; // Re-throw to rollback transaction
        }
      }
    };
    
    // Truncate core tables - CASCADE will handle dependent tables
    await safeTruncate('lists');
    await safeTruncate('venues');
    await safeTruncate('neighborhoods');
    await safeTruncate('cities');
    console.log('   ℹ️ Keeping existing users...');

    // Insert cities
    console.log('📍 Inserting cities...');
    for (const city of seedData.cities) {
      await client.query(
        `INSERT INTO cities (id, name, state, country, description, image_url, timezone, coordinates)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         image_url = EXCLUDED.image_url`,
        [
          city.id,
          city.name,
          city.state,
          city.country,
          city.description,
          city.image_url,
          city.timezone,
          JSON.stringify(city.coordinates),
        ]
      );
    }
    console.log(`✅ Inserted ${seedData.cities.length} cities`);

    // Insert neighborhoods if available
    if (seedData.neighborhoods && seedData.neighborhoods.length > 0) {
      console.log('🏘️  Inserting neighborhoods...');
      for (const neighborhood of seedData.neighborhoods) {
        await client.query(
          `INSERT INTO neighborhoods (id, name, city_id, description, coordinates, image_url)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description`,
          [
            neighborhood.id,
            neighborhood.name,
            neighborhood.city_id,
            neighborhood.description,
            neighborhood.coordinates ? JSON.stringify(neighborhood.coordinates) : null,
            neighborhood.image_url,
          ]
        );
      }
      console.log(`✅ Inserted ${seedData.neighborhoods.length} neighborhoods`);
    }

    // Insert venues
    console.log('🏪 Inserting venues...');
    // Track inserted venue IDs for list-venue validation
    const insertedVenueIds = new Set<string>();
    // Get valid city IDs
    const validCityIds = new Set(seedData.cities.map(c => c.id));
    let skippedVenues = 0;

    for (const venue of seedData.venues) {
      // Skip venues with invalid city_id
      if (!validCityIds.has(venue.city_id)) {
        skippedVenues++;
        continue;
      }

      const priceRange = venue.price_range || '$'.repeat(venue.price_level || 2);

      // Normalize features
      let features: string[] = [];
      if (venue.features) {
        if (Array.isArray(venue.features)) {
          features = venue.features;
        } else if (typeof venue.features === 'object') {
          features = Object.entries(venue.features)
            .filter(([, v]) => v === true)
            .map(([k]) => k);
        }
      }

      await client.query(
        `INSERT INTO venues (id, name, city_id, neighborhood_id, category, cuisine, price_range, description,
         address, phone, website, image_url, rating, coordinates, hours, features)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         rating = EXCLUDED.rating,
         hours = EXCLUDED.hours,
         neighborhood_id = EXCLUDED.neighborhood_id`,
        [
          venue.id,
          venue.name,
          venue.city_id,
          venue.neighborhood_id || null,
          venue.category,
          venue.cuisine || venue.category,
          priceRange,
          venue.description,
          venue.address,
          venue.phone,
          venue.website,
          venue.image_url,
          parseFloat(venue.rating) || 4.0,
          JSON.stringify(venue.coordinates),
          JSON.stringify(venue.hours || {}),
          JSON.stringify(features),
        ]
      );
      insertedVenueIds.add(venue.id);
    }
    console.log(`✅ Inserted ${insertedVenueIds.size} venues (skipped ${skippedVenues} with invalid city_id)`);

    // Insert users
    console.log('👤 Inserting users...');
    for (const user of seedData.users) {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const userId = isValidUUID(user.id) ? user.id : crypto.randomUUID();
      userIdMap.set(user.id, userId);
      const fullName = user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim();

      await client.query(
        `INSERT INTO users (id, email, password_hash, phone, username, full_name, bio, avatar_url, is_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (email) DO UPDATE SET
         username = EXCLUDED.username,
         full_name = EXCLUDED.full_name`,
        [
          userId,
          user.email,
          hashedPassword,
          user.phone,
          user.username || user.email.split('@')[0],
          fullName,
          user.bio,
          user.avatar_url,
          user.is_verified || false,
          user.created_at || new Date().toISOString(),
          user.updated_at || new Date().toISOString(),
        ]
      );
    }
    console.log(`✅ Inserted ${seedData.users.length} users`);

    // Insert lists
    console.log('📋 Inserting lists...');
    for (const list of seedData.lists) {
      let userId: string | null = null;
      if (!list.is_curated && seedData.user_lists) {
        const userList = seedData.user_lists.find((ul: any) => ul.list_id === list.id);
        if (userList) {
          userId = userIdMap.get(userList.user_id) || userList.user_id;
        }
      }

      await client.query(
        `INSERT INTO lists (id, name, city_id, category, description, curator, is_featured, image_url, user_id, is_public, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         is_featured = EXCLUDED.is_featured,
         category = EXCLUDED.category`,
        [
          list.id,
          list.name,
          list.city_id,
          list.category,
          list.description,
          list.curator || (list.is_curated ? 'Localist Team' : null),
          list.is_featured || false,
          list.image_url,
          userId,
          list.is_public !== false,
          list.created_at || new Date().toISOString(),
          list.updated_at || new Date().toISOString(),
        ]
      );
    }
    console.log(`✅ Inserted ${seedData.lists.length} lists`);

    // Insert list-venue relationships
    if (seedData.list_venues && seedData.list_venues.length > 0) {
      console.log('🔗 Inserting list-venue relationships...');
      let insertedRelations = 0;
      let skippedRelations = 0;

      for (const relation of seedData.list_venues) {
        // Use our tracked set instead of querying database
        if (!insertedVenueIds.has(relation.venue_id)) {
          skippedRelations++;
          continue;
        }
        await client.query(
          `INSERT INTO list_venues (list_id, venue_id, position, notes, added_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (list_id, venue_id) DO UPDATE SET
           position = EXCLUDED.position`,
          [
            relation.list_id,
            relation.venue_id,
            relation.position || 0,
            relation.notes,
            relation.added_at || new Date().toISOString(),
          ]
        );
        insertedRelations++;
      }
      console.log(`✅ Inserted ${insertedRelations} list-venue relationships (skipped ${skippedRelations})`);

      // Update venue_ids array in lists table
      console.log('📊 Updating list venue_ids arrays...');
      const listVenueGroups: { [key: string]: string[] } = {};
      for (const relation of seedData.list_venues) {
        if (insertedVenueIds.has(relation.venue_id)) {
          if (!listVenueGroups[relation.list_id]) {
            listVenueGroups[relation.list_id] = [];
          }
          listVenueGroups[relation.list_id].push(relation.venue_id);
        }
      }

      for (const [listId, venueIds] of Object.entries(listVenueGroups)) {
        await client.query(`UPDATE lists SET venue_ids = $1 WHERE id = $2`, [venueIds, listId]);
      }
    }

    // Commit the transaction
    await client.query('COMMIT');
    console.log('✨ Database seeding completed successfully!');

    // Show summary (using pool for read-after-commit)
    const cityCount = await pool.query('SELECT COUNT(*) FROM cities');
    const neighborhoodCount = await pool.query('SELECT COUNT(*) FROM neighborhoods');
    const venueCount = await pool.query('SELECT COUNT(*) FROM venues');
    const listCount = await pool.query('SELECT COUNT(*) FROM lists');
    const listVenueCount = await pool.query('SELECT COUNT(*) FROM list_venues');
    const userCount = await pool.query('SELECT COUNT(*) FROM users');

    console.log('\n📊 Database Summary:');
    console.log(`   Cities: ${cityCount.rows[0].count}`);
    console.log(`   Neighborhoods: ${neighborhoodCount.rows[0].count}`);
    console.log(`   Venues: ${venueCount.rows[0].count}`);
    console.log(`   Lists: ${listCount.rows[0].count}`);
    console.log(`   List-Venue Relations: ${listVenueCount.rows[0].count}`);
    console.log(`   Users: ${userCount.rows[0].count}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding database:', error);
    throw error;
  } finally {
    client.release(); // Release client back to pool
    await pool.end();
  }
}

// Run the seed function if this file is executed directly
if (require.main === module) {
  seed().catch(console.error);
}

export default seed;

