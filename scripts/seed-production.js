const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Direct production database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres-service',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'localist',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgresstrongpassword123',
});

async function seed() {
  console.log('🌱 Starting production database seeding...');

  try {
    // Load comprehensive seed data
    const seedDataPath = process.env.SEED_DATA_PATH || '/tmp/seed-data.json';

    if (!fs.existsSync(seedDataPath)) {
      console.error('Seed data not found at:', seedDataPath);
      process.exit(1);
    }

    const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));
    console.log('📊 Loaded seed data:', {
      cities: seedData.cities?.length || 0,
      venues: seedData.venues?.length || 0,
      lists: seedData.lists?.length || 0,
      users: seedData.users?.length || 0
    });

    await pool.query('BEGIN');

    // Clear existing data in correct order
    console.log('🧹 Clearing existing data...');
    await pool.query('DELETE FROM saved_venues');
    await pool.query('DELETE FROM list_venues');
    await pool.query('DELETE FROM user_lists');
    await pool.query('DELETE FROM lists');
    await pool.query('DELETE FROM venues');
    await pool.query('DELETE FROM cities');
    await pool.query('DELETE FROM users WHERE email != \'admin@localist.ai\'');

    // Insert cities
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
          JSON.stringify(city.coordinates)
        ]
      );
    }
    console.log(`✅ Inserted ${seedData.cities.length} cities`);

    // Insert venues
    console.log('🏪 Inserting venues...');
    let venueCount = 0;
    for (const venue of seedData.venues) {
      const priceRange = venue.price_level ? '$'.repeat(venue.price_level) : '$$';

      // Convert features object to array of feature names
      const featureArray = [];
      if (venue.features) {
        Object.entries(venue.features).forEach(([key, value]) => {
          if (value === true) {
            featureArray.push(key.replace(/_/g, ' '));
          }
        });
      }

      await pool.query(
        `INSERT INTO venues (id, name, city_id, category, cuisine, price_range, description,
         address, phone, website, image_url, rating, coordinates, hours, features)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         rating = EXCLUDED.rating`,
        [
          venue.id,
          venue.name,
          venue.city_id,
          venue.category,
          venue.category, // Use category as cuisine
          priceRange,
          venue.description,
          venue.address,
          venue.phone,
          venue.website,
          venue.image_url,
          parseFloat(venue.rating) || 4.0,
          JSON.stringify(venue.coordinates),
          JSON.stringify(venue.hours),
          featureArray // Pass as array directly
        ]
      );
      venueCount++;

      if (venueCount % 100 === 0) {
        console.log(`  Processed ${venueCount} venues...`);
      }
    }
    console.log(`✅ Inserted ${seedData.venues.length} venues`);

    // Insert users
    console.log('👤 Inserting users...');
    for (const user of seedData.users) {
      const hashedPassword = await bcrypt.hash('password123', 10);

      await pool.query(
        `INSERT INTO users (id, email, password_hash, phone, username, full_name, bio, avatar_url, is_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (email) DO UPDATE SET
         username = EXCLUDED.username,
         full_name = EXCLUDED.full_name`,
        [
          user.id,
          user.email,
          hashedPassword,
          user.phone,
          user.username,
          user.full_name,
          user.bio,
          user.avatar_url,
          user.is_verified || false,
          user.created_at || new Date().toISOString(),
          user.updated_at || new Date().toISOString()
        ]
      );
    }
    console.log(`✅ Inserted ${seedData.users.length} users`);

    // Insert lists
    console.log('📋 Inserting lists...');
    for (const list of seedData.lists) {
      let userId = null;
      if (!list.is_curated && seedData.user_lists) {
        const userList = seedData.user_lists.find(ul => ul.list_id === list.id);
        userId = userList ? userList.user_id : null;
      }

      await pool.query(
        `INSERT INTO lists (id, name, city_id, category, description, curator, is_featured, image_url, user_id, is_public, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         is_featured = EXCLUDED.is_featured`,
        [
          list.id,
          list.name,
          list.city_id,
          list.category,
          list.description,
          list.is_curated ? 'DiscoverLocal Team' : null,
          list.is_featured || false,
          list.image_url,
          userId,
          list.is_public !== false,
          list.created_at || new Date().toISOString(),
          list.updated_at || new Date().toISOString()
        ]
      );
    }
    console.log(`✅ Inserted ${seedData.lists.length} lists`);

    // Insert list-venue relationships
    if (seedData.list_venues && seedData.list_venues.length > 0) {
      console.log('🔗 Inserting list-venue relationships...');
      let relationCount = 0;

      for (const relation of seedData.list_venues) {
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
            relation.added_at || new Date().toISOString()
          ]
        );
        relationCount++;

        if (relationCount % 100 === 0) {
          console.log(`  Processed ${relationCount} relationships...`);
        }
      }
      console.log(`✅ Inserted ${seedData.list_venues.length} list-venue relationships`);

      // Update venue_ids arrays
      console.log('📊 Updating list venue_ids arrays...');
      const listVenueGroups = {};
      for (const relation of seedData.list_venues) {
        if (!listVenueGroups[relation.list_id]) {
          listVenueGroups[relation.list_id] = [];
        }
        listVenueGroups[relation.list_id].push(relation.venue_id);
      }

      for (const [listId, venueIds] of Object.entries(listVenueGroups)) {
        await pool.query(
          `UPDATE lists SET venue_ids = $1 WHERE id = $2`,
          [venueIds, listId]
        );
      }
    }

    await pool.query('COMMIT');
    console.log('✨ Database seeding completed successfully!');

    // Show summary
    const cityCountResult = await pool.query('SELECT COUNT(*) FROM cities');
    const venueCountResult = await pool.query('SELECT COUNT(*) FROM venues');
    const listCountResult = await pool.query('SELECT COUNT(*) FROM lists');
    const listVenueCountResult = await pool.query('SELECT COUNT(*) FROM list_venues');
    const userCountResult = await pool.query('SELECT COUNT(*) FROM users');

    console.log('\n📊 Database Summary:');
    console.log(`   Cities: ${cityCountResult.rows[0].count}`);
    console.log(`   Venues: ${venueCountResult.rows[0].count}`);
    console.log(`   Lists: ${listCountResult.rows[0].count}`);
    console.log(`   List-Venue Relations: ${listVenueCountResult.rows[0].count}`);
    console.log(`   Users: ${userCountResult.rows[0].count}`);

    process.exit(0);

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

// Run the seed function
seed().catch(console.error);