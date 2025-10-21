import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Define the list categories (16 per city as per requirements)
const listCategories = [
  { name: 'Best Brunch Spots', description: 'Perfect weekend brunch destinations', category: 'dining' },
  { name: 'Late Night Eats', description: 'Open late when you need them most', category: 'dining' },
  { name: 'Date Night Favorites', description: 'Romantic spots for special occasions', category: 'dining' },
  { name: 'Hidden Gems', description: 'Off-the-beaten-path local favorites', category: 'discovery' },
  { name: 'Rooftop Bars', description: 'Drinks with a view', category: 'nightlife' },
  { name: 'Craft Cocktails', description: 'Expertly mixed drinks and creative concoctions', category: 'nightlife' },
  { name: 'Live Music Venues', description: 'Catch amazing performances', category: 'entertainment' },
  { name: 'Happy Hour Deals', description: 'Best drink and food specials', category: 'deals' },
  { name: 'Vegan & Vegetarian', description: 'Plant-based paradise', category: 'dietary' },
  { name: 'Family Friendly', description: 'Great spots for the whole family', category: 'family' },
  { name: 'Business Lunch', description: 'Perfect for client meetings', category: 'business' },
  { name: 'Wine Bars', description: 'Curated selections and cozy vibes', category: 'nightlife' },
  { name: 'Pizza Perfection', description: 'The best slices in town', category: 'cuisine' },
  { name: 'Asian Fusion', description: 'Creative East meets West', category: 'cuisine' },
  { name: 'Seafood Specialists', description: 'Fresh from the ocean', category: 'cuisine' },
  { name: 'Coffee Culture', description: 'Best coffee shops and cafes', category: 'cafe' }
];

// Venue name prefixes and suffixes for generation
const venueNames = {
  prefixes: ['The', 'Le', 'La', 'Il', 'El', 'Casa', 'Chez', 'Bistro', 'Cafe', 'Bar', 'Tavern', 'Kitchen'],
  middles: ['Blue', 'Red', 'Golden', 'Silver', 'Royal', 'Grand', 'Urban', 'Modern', 'Classic', 'Rustic',
            'Local', 'Social', 'Craft', 'Artisan', 'Garden', 'Harbor', 'Market', 'Corner', 'District'],
  suffixes: ['Room', 'House', 'Place', 'Spot', 'Joint', 'Grill', 'Eatery', 'Lounge', 'Club', 'Cantina',
            'Brasserie', 'Gastropub', 'Taphouse', 'Kitchen', 'Table', 'Bar', 'Restaurant', 'Cafe']
};

// Venue categories
const venueCategories = ['restaurant', 'bar', 'cafe', 'nightclub', 'lounge', 'gastropub', 'bistro', 'brasserie'];

// Street names for addresses
const streetNames = ['Main', 'Broadway', 'Market', 'Park', 'Oak', 'Maple', 'Cedar', 'Pine', 'Elm', 'Washington',
                    'Lincoln', 'Madison', 'Jefferson', 'Adams', 'Jackson', 'Monroe', 'Harrison', 'Tyler'];
const streetTypes = ['St', 'Ave', 'Blvd', 'Rd', 'Ln', 'Dr', 'Way', 'Pl', 'Ct'];

function generateVenueName(): string {
  const usePrefix = Math.random() > 0.3;
  const useMiddle = Math.random() > 0.2;

  let name = '';
  if (usePrefix) {
    name += venueNames.prefixes[Math.floor(Math.random() * venueNames.prefixes.length)] + ' ';
  }
  if (useMiddle) {
    name += venueNames.middles[Math.floor(Math.random() * venueNames.middles.length)] + ' ';
  }
  name += venueNames.suffixes[Math.floor(Math.random() * venueNames.suffixes.length)];

  return name.trim();
}

function generateAddress(city: any): string {
  const number = Math.floor(Math.random() * 9999) + 1;
  const street = streetNames[Math.floor(Math.random() * streetNames.length)];
  const type = streetTypes[Math.floor(Math.random() * streetTypes.length)];
  return `${number} ${street} ${type}, ${city.name}, ${city.state} ${10000 + Math.floor(Math.random() * 90000)}`;
}

function generatePhoneNumber(): string {
  const areaCode = 200 + Math.floor(Math.random() * 800);
  const prefix = 200 + Math.floor(Math.random() * 800);
  const suffix = 1000 + Math.floor(Math.random() * 9000);
  return `(${areaCode}) ${prefix}-${suffix}`;
}

function generateHours(): any {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const hours: any = {};

  days.forEach(day => {
    if (day === 'monday' && Math.random() > 0.8) {
      hours[day] = { open: null, close: null }; // Closed Mondays sometimes
    } else {
      const openHour = 7 + Math.floor(Math.random() * 5); // 7am - 11am
      const closeHour = 20 + Math.floor(Math.random() * 4); // 8pm - 11pm
      hours[day] = {
        open: `${openHour}:00`,
        close: `${closeHour}:00`
      };
    }
  });

  return hours;
}

function generatePriceLevel(): number {
  const weights = [0.2, 0.4, 0.3, 0.1]; // $ = 20%, $$ = 40%, $$$ = 30%, $$$$ = 10%
  const random = Math.random();
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i];
    if (random < sum) return i + 1;
  }
  return 2;
}

async function generateSeedData() {
  console.log('Generating comprehensive seed data...');

  // Cities data
  const cities = [
    {
      id: 'nyc',
      name: 'New York City',
      state: 'NY',
      country: 'US',
      description: 'The city that never sleeps',
      image_url: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800',
      timezone: 'America/New_York',
      coordinates: { lat: 40.7128, lng: -74.0060 }
    },
    {
      id: 'la',
      name: 'Los Angeles',
      state: 'CA',
      country: 'US',
      description: 'City of Angels',
      image_url: 'https://images.unsplash.com/photo-1534190760961-74e8c1c5c3da?w=800',
      timezone: 'America/Los_Angeles',
      coordinates: { lat: 34.0522, lng: -118.2437 }
    },
    {
      id: 'chicago',
      name: 'Chicago',
      state: 'IL',
      country: 'US',
      description: 'The Windy City',
      image_url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800',
      timezone: 'America/Chicago',
      coordinates: { lat: 41.8781, lng: -87.6298 }
    },
    {
      id: 'miami',
      name: 'Miami',
      state: 'FL',
      country: 'US',
      description: 'Magic City',
      image_url: 'https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=800',
      timezone: 'America/New_York',
      coordinates: { lat: 25.7617, lng: -80.1918 }
    },
    {
      id: 'vegas',
      name: 'Las Vegas',
      state: 'NV',
      country: 'US',
      description: 'Entertainment Capital of the World',
      image_url: 'https://images.unsplash.com/photo-1605833556294-ea5c7a74f57d?w=800',
      timezone: 'America/Los_Angeles',
      coordinates: { lat: 36.1699, lng: -115.1398 }
    }
  ];

  // Generate venues (approximately 320 per city = 1600 total)
  const venues: any[] = [];
  const venuesByCityAndCategory: any = {};

  cities.forEach(city => {
    venuesByCityAndCategory[city.id] = {};

    // Generate 320 venues per city
    for (let i = 0; i < 320; i++) {
      const venueId = uuidv4();
      const category = venueCategories[Math.floor(Math.random() * venueCategories.length)];

      const venue = {
        id: venueId,
        name: generateVenueName(),
        address: generateAddress(city),
        city_id: city.id,
        category: category,
        description: `A wonderful ${category} in the heart of ${city.name}`,
        phone: generatePhoneNumber(),
        website: `https://example-${venueId.slice(0, 8)}.com`,
        hours: generateHours(),
        price_level: generatePriceLevel(),
        rating: (3.5 + Math.random() * 1.5).toFixed(1),
        total_ratings: Math.floor(Math.random() * 500) + 50,
        image_url: `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 100000000000)}?w=400`,
        coordinates: {
          lat: city.coordinates.lat + (Math.random() - 0.5) * 0.2,
          lng: city.coordinates.lng + (Math.random() - 0.5) * 0.2
        },
        features: {
          outdoor_seating: Math.random() > 0.5,
          delivery: Math.random() > 0.3,
          takeout: Math.random() > 0.2,
          reservations: Math.random() > 0.4,
          wifi: Math.random() > 0.6,
          parking: Math.random() > 0.5,
          wheelchair_accessible: Math.random() > 0.7,
          live_music: Math.random() > 0.8,
          happy_hour: Math.random() > 0.6
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      venues.push(venue);

      // Track venues by category for list assignment
      if (!venuesByCityAndCategory[city.id][category]) {
        venuesByCityAndCategory[city.id][category] = [];
      }
      venuesByCityAndCategory[city.id][category].push(venue);
    }
  });

  // Generate lists (16 per city = 80 total)
  const lists: any[] = [];
  const listVenueRelations: any[] = [];

  cities.forEach(city => {
    listCategories.forEach(listTemplate => {
      const listId = uuidv4();

      const list = {
        id: listId,
        city_id: city.id,
        name: `${city.name} ${listTemplate.name}`,
        description: `${listTemplate.description} in ${city.name}`,
        category: listTemplate.category,
        image_url: `https://images.unsplash.com/photo-${1500000000000 + Math.floor(Math.random() * 100000000000)}?w=400`,
        is_curated: true,
        is_featured: Math.random() > 0.7,
        follower_count: Math.floor(Math.random() * 1000) + 100,
        venue_count: 20, // Will add exactly 20 venues per list
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      lists.push(list);

      // Add 20 random venues to each list
      const cityVenues = venues.filter(v => v.city_id === city.id);
      const selectedVenues = new Set<string>();

      while (selectedVenues.size < 20 && selectedVenues.size < cityVenues.length) {
        const randomVenue = cityVenues[Math.floor(Math.random() * cityVenues.length)];
        if (!selectedVenues.has(randomVenue.id)) {
          selectedVenues.add(randomVenue.id);
          listVenueRelations.push({
            list_id: listId,
            venue_id: randomVenue.id,
            position: selectedVenues.size,
            notes: `Featured in ${list.name}`,
            added_at: new Date().toISOString()
          });
        }
      }
    });
  });

  // Generate sample users
  const users = [
    {
      id: uuidv4(),
      email: 'admin@localist.ai',
      phone: '+1234567890',
      username: 'admin',
      full_name: 'Admin User',
      bio: 'Platform administrator',
      avatar_url: 'https://ui-avatars.com/api/?name=Admin+User',
      is_verified: true,
      is_admin: true,
      preferences: {
        notifications: true,
        newsletter: true,
        privacy: 'public'
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: uuidv4(),
      email: 'demo@localist.ai',
      phone: '+1234567891',
      username: 'demo_user',
      full_name: 'Demo User',
      bio: 'Just exploring great places!',
      avatar_url: 'https://ui-avatars.com/api/?name=Demo+User',
      is_verified: true,
      is_admin: false,
      preferences: {
        notifications: true,
        newsletter: false,
        privacy: 'public'
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  // Generate user lists (non-curated)
  const userLists: any[] = [];
  users.forEach(user => {
    if (!user.is_admin) {
      for (let i = 0; i < 3; i++) {
        const userListId = uuidv4();
        const city = cities[Math.floor(Math.random() * cities.length)];

        const userList = {
          id: userListId,
          user_id: user.id,
          city_id: city.id,
          name: `My ${city.name} Favorites ${i + 1}`,
          description: `Personal collection of favorite spots in ${city.name}`,
          category: 'personal',
          is_public: true,
          is_curated: false,
          follower_count: Math.floor(Math.random() * 50),
          venue_count: 10,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        userLists.push(userList);

        // Add 10 random venues to each user list
        const cityVenues = venues.filter(v => v.city_id === city.id);
        const selectedVenues = new Set<string>();

        while (selectedVenues.size < 10 && selectedVenues.size < cityVenues.length) {
          const randomVenue = cityVenues[Math.floor(Math.random() * cityVenues.length)];
          if (!selectedVenues.has(randomVenue.id)) {
            selectedVenues.add(randomVenue.id);
            listVenueRelations.push({
              list_id: userListId,
              venue_id: randomVenue.id,
              position: selectedVenues.size,
              notes: `Added to ${userList.name}`,
              added_at: new Date().toISOString()
            });
          }
        }
      }
    }
  });

  // Combine all lists
  const allLists = [...lists, ...userLists];

  // Create the seed data object
  const seedData = {
    cities,
    venues,
    lists: allLists,
    list_venues: listVenueRelations,
    users,
    user_lists: userLists.map(ul => ({
      user_id: ul.user_id,
      list_id: ul.id,
      created_at: ul.created_at
    })),
    saved_venues: [] // Will be populated when users save venues
  };

  // Write to file
  const outputPath = path.join(__dirname, '../../data/comprehensive-seed-data.json');
  fs.writeFileSync(outputPath, JSON.stringify(seedData, null, 2));

  console.log('✅ Seed data generated successfully!');
  console.log(`📊 Statistics:`);
  console.log(`   - Cities: ${cities.length}`);
  console.log(`   - Venues: ${venues.length} (${venues.length / cities.length} per city)`);
  console.log(`   - Curated Lists: ${lists.length} (${lists.length / cities.length} per city)`);
  console.log(`   - User Lists: ${userLists.length}`);
  console.log(`   - Total Lists: ${allLists.length}`);
  console.log(`   - List-Venue Relations: ${listVenueRelations.length}`);
  console.log(`   - Users: ${users.length}`);
  console.log(`📁 Output saved to: ${outputPath}`);
}

// Run the generator
generateSeedData().catch(console.error);