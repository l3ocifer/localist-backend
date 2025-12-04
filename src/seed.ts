import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

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

    await pool.query('BEGIN');

    // Clear existing data using TRUNCATE CASCADE to handle foreign keys
    console.log('🧹 Clearing existing data...');
    // Use TRUNCATE CASCADE for tables with foreign key relationships
    // This handles all dependent tables automatically
    const safeTruncate = async (table: string) => {
      try { 
        await pool.query(`TRUNCATE TABLE ${table} CASCADE`); 
        console.log(`   ✅ Truncated ${table}`);
      } catch (e: any) { 
        if (e.code === '42P01') {
          console.log(`   ⚠️ Table ${table} not found, skipping...`);
        } else {
          console.log(`   ⚠️ Could not truncate ${table}: ${e.message}`);
        }
      }
    };
    
    // Truncate core tables - CASCADE will handle dependent tables
    await safeTruncate('lists'); // This cascades to list_venues
    await safeTruncate('venues'); // This cascades to saved_venues, list_venues
    await safeTruncate('neighborhoods');
    await safeTruncate('cities'); // This cascades to venues, neighborhoods
    // Don't truncate users - keep existing users
    console.log('   ℹ️ Keeping existing users...');

    console.log('📍 Inserting cities...');
    for (const city of seedData.cities) {
      await pool.query(
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
        await pool.query(
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

    console.log('🏪 Inserting venues...');
    // Get valid city IDs from the database
    const validCitiesResult = await pool.query('SELECT id FROM cities');
    const validCityIds = new Set(validCitiesResult.rows.map((r: { id: string }) => r.id));
    let skippedVenues = 0;
    let insertedVenues = 0;

    for (const venue of seedData.venues) {
      // Skip venues with invalid city_id
      if (!validCityIds.has(venue.city_id)) {
        skippedVenues++;
        continue;
      }

      // Map price_level to price_range string
      const priceRange = venue.price_range || '$'.repeat(venue.price_level || 2);

      // Normalize features: convert object to array of enabled feature names
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

      await pool.query(
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
          features, // PostgreSQL handles JS arrays directly via pg driver
        ]
      );
      insertedVenues++;
    }
    console.log(`✅ Inserted ${insertedVenues} venues (skipped ${skippedVenues} with invalid city_id)`);

    console.log('👤 Inserting users...');
    for (const user of seedData.users) {
      const hashedPassword = await bcrypt.hash('password123', 10); // Default password for seed users

      // Generate UUID if the ID is not a valid UUID (handle legacy string IDs)
      const userId = isValidUUID(user.id) ? user.id : crypto.randomUUID();
      userIdMap.set(user.id, userId); // Track mapping for later use

      const fullName = user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim();

      await pool.query(
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

    console.log('📋 Inserting lists...');
    for (const list of seedData.lists) {
      // Determine user_id - if not curated, try to find from user_lists
      let userId: string | null = null;
      if (!list.is_curated && seedData.user_lists) {
        const userList = seedData.user_lists.find((ul: any) => ul.list_id === list.id);
        if (userList) {
          // Use mapped UUID if we converted the ID
          userId = userIdMap.get(userList.user_id) || userList.user_id;
        }
      }

      await pool.query(
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
          list.is_public !== false, // Default to true
          list.created_at || new Date().toISOString(),
          list.updated_at || new Date().toISOString(),
        ]
      );
    }
    console.log(`✅ Inserted ${seedData.lists.length} lists`);

    // Insert list-venue relationships if available
    if (seedData.list_venues && seedData.list_venues.length > 0) {
      console.log('🔗 Inserting list-venue relationships...');
      // Get valid venue IDs that were actually inserted
      const validVenuesResult = await pool.query('SELECT id FROM venues');
      const validVenueIds = new Set(validVenuesResult.rows.map((r: { id: string }) => r.id));
      let insertedRelations = 0;
      let skippedRelations = 0;

      for (const relation of seedData.list_venues) {
        // Skip if venue doesn't exist
        if (!validVenueIds.has(relation.venue_id)) {
          skippedRelations++;
          continue;
        }
        try {
          await pool.query(
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
        } catch (e) {
          skippedRelations++;
        }
      }
      console.log(`✅ Inserted ${insertedRelations} list-venue relationships (skipped ${skippedRelations})`);

      // Update venue_ids array in lists table for compatibility
      console.log('📊 Updating list venue_ids arrays...');
      const listVenueGroups: { [key: string]: string[] } = {};
      for (const relation of seedData.list_venues) {
        if (!listVenueGroups[relation.list_id]) {
          listVenueGroups[relation.list_id] = [];
        }
        listVenueGroups[relation.list_id].push(relation.venue_id);
      }

      for (const [listId, venueIds] of Object.entries(listVenueGroups)) {
        await pool.query(`UPDATE lists SET venue_ids = $1 WHERE id = $2`, [venueIds, listId]);
      }
    }

    // Note: user_lists in seed data represents user-created lists, not junction table
    // The seed data format has user_lists as standalone entities, but schema has it as junction
    // Skip for now - user lists are created through the app flow
    if (seedData.user_lists && seedData.user_lists.length > 0) {
      console.log('ℹ️  Skipping user_lists (handled via app flow)');
    }

    await pool.query('COMMIT');
    console.log('✨ Database seeding completed successfully!');

    // Show summary
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
    await pool.query('ROLLBACK');
    console.error('❌ Error seeding database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the seed function if this file is executed directly
if (require.main === module) {
  seed().catch(console.error);
}

export default seed;
