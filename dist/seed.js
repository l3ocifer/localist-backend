"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const bcrypt = __importStar(require("bcryptjs"));
const dotenv = __importStar(require("dotenv"));
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../.env.local', override: true });
const pool = new pg_1.Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'localist',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});
async function seed() {
    console.log('🌱 Starting database seeding...');
    try {
        // Try comprehensive seed data first, fall back to basic if not available
        let seedDataPath = path.join(__dirname, '../../data/comprehensive-seed-data.json');
        if (!fs.existsSync(seedDataPath)) {
            console.log('📝 Comprehensive seed data not found, using basic seed data...');
            seedDataPath = path.join(__dirname, '../../data/seed-data.json');
        }
        const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));
        await pool.query('BEGIN');
        // Clear existing data in correct order (respecting foreign key constraints)
        console.log('🧹 Clearing existing data...');
        await pool.query('DELETE FROM saved_venues');
        await pool.query('DELETE FROM list_venues');
        await pool.query('DELETE FROM user_lists');
        await pool.query('DELETE FROM lists');
        await pool.query('DELETE FROM venues');
        await pool.query('DELETE FROM cities');
        await pool.query('DELETE FROM users WHERE email != \'admin@localist.ai\''); // Keep admin user if exists
        console.log('📍 Inserting cities...');
        for (const city of seedData.cities) {
            await pool.query(`INSERT INTO cities (id, name, state, country, description, image_url, timezone, coordinates)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         image_url = EXCLUDED.image_url`, [
                city.id,
                city.name,
                city.state,
                city.country,
                city.description,
                city.image_url,
                city.timezone,
                JSON.stringify(city.coordinates)
            ]);
        }
        console.log(`✅ Inserted ${seedData.cities.length} cities`);
        console.log('🏪 Inserting venues...');
        for (const venue of seedData.venues) {
            // Map price_level to price_range string
            const priceRange = '$'.repeat(venue.price_level || 2);
            await pool.query(`INSERT INTO venues (id, name, city_id, category, cuisine, price_range, description,
         address, phone, website, image_url, rating, coordinates, hours, features)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         rating = EXCLUDED.rating,
         hours = EXCLUDED.hours`, [
                venue.id,
                venue.name,
                venue.city_id,
                venue.category,
                venue.category, // Use category as cuisine for now
                priceRange,
                venue.description,
                venue.address,
                venue.phone,
                venue.website,
                venue.image_url,
                parseFloat(venue.rating) || 4.0,
                JSON.stringify(venue.coordinates),
                JSON.stringify(venue.hours),
                venue.features ? JSON.stringify(venue.features) : '[]'
            ]);
        }
        console.log(`✅ Inserted ${seedData.venues.length} venues`);
        console.log('👤 Inserting users...');
        for (const user of seedData.users) {
            const hashedPassword = await bcrypt.hash('password123', 10); // Default password for seed users
            await pool.query(`INSERT INTO users (id, email, password_hash, phone, username, full_name, bio, avatar_url, is_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (email) DO UPDATE SET
         username = EXCLUDED.username,
         full_name = EXCLUDED.full_name`, [
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
            ]);
        }
        console.log(`✅ Inserted ${seedData.users.length} users`);
        console.log('📋 Inserting lists...');
        for (const list of seedData.lists) {
            // Determine user_id - if not curated, try to find from user_lists
            let userId = null;
            if (!list.is_curated && seedData.user_lists) {
                const userList = seedData.user_lists.find((ul) => ul.list_id === list.id);
                userId = userList ? userList.user_id : null;
            }
            await pool.query(`INSERT INTO lists (id, name, city_id, category, description, curator, is_featured, image_url, user_id, is_public, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         is_featured = EXCLUDED.is_featured`, [
                list.id,
                list.name,
                list.city_id,
                list.category,
                list.description,
                list.is_curated ? 'DiscoverLocal Team' : null,
                list.is_featured || false,
                list.image_url,
                userId,
                list.is_public !== false, // Default to true
                list.created_at || new Date().toISOString(),
                list.updated_at || new Date().toISOString()
            ]);
        }
        console.log(`✅ Inserted ${seedData.lists.length} lists`);
        // Insert list-venue relationships if available
        if (seedData.list_venues && seedData.list_venues.length > 0) {
            console.log('🔗 Inserting list-venue relationships...');
            for (const relation of seedData.list_venues) {
                await pool.query(`INSERT INTO list_venues (list_id, venue_id, position, notes, added_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (list_id, venue_id) DO UPDATE SET
           position = EXCLUDED.position`, [
                    relation.list_id,
                    relation.venue_id,
                    relation.position || 0,
                    relation.notes,
                    relation.added_at || new Date().toISOString()
                ]);
            }
            console.log(`✅ Inserted ${seedData.list_venues.length} list-venue relationships`);
            // Update venue_ids array in lists table for compatibility
            console.log('📊 Updating list venue_ids arrays...');
            const listVenueGroups = {};
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
        // Insert user_lists relationships if available
        if (seedData.user_lists && seedData.user_lists.length > 0) {
            console.log('👥 Inserting user-list relationships...');
            for (const userList of seedData.user_lists) {
                await pool.query(`INSERT INTO user_lists (user_id, list_id, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, list_id) DO NOTHING`, [
                    userList.user_id,
                    userList.list_id,
                    userList.created_at || new Date().toISOString()
                ]);
            }
            console.log(`✅ Inserted ${seedData.user_lists.length} user-list relationships`);
        }
        await pool.query('COMMIT');
        console.log('✨ Database seeding completed successfully!');
        // Show summary
        const cityCount = await pool.query('SELECT COUNT(*) FROM cities');
        const venueCount = await pool.query('SELECT COUNT(*) FROM venues');
        const listCount = await pool.query('SELECT COUNT(*) FROM lists');
        const listVenueCount = await pool.query('SELECT COUNT(*) FROM list_venues');
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        console.log('\n📊 Database Summary:');
        console.log(`   Cities: ${cityCount.rows[0].count}`);
        console.log(`   Venues: ${venueCount.rows[0].count}`);
        console.log(`   Lists: ${listCount.rows[0].count}`);
        console.log(`   List-Venue Relations: ${listVenueCount.rows[0].count}`);
        console.log(`   Users: ${userCount.rows[0].count}`);
    }
    catch (error) {
        await pool.query('ROLLBACK');
        console.error('❌ Error seeding database:', error);
        throw error;
    }
    finally {
        await pool.end();
    }
}
// Run the seed function if this file is executed directly
if (require.main === module) {
    seed().catch(console.error);
}
exports.default = seed;
//# sourceMappingURL=seed.js.map