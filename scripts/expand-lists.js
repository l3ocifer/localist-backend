#!/usr/bin/env node
/**
 * Expand seed-data.json with comprehensive list taxonomy
 * 
 * Run: node scripts/expand-lists.js
 * 
 * This script:
 * 1. Ensures all 15 MVP cities exist
 * 2. Adds lists for all cuisines, dishes, and occasions per city
 * 3. Works automatically for any new city added to seed-data.json
 * 4. Writes back to seed-data.json (idempotent - safe to run multiple times)
 */

const fs = require('fs');
const path = require('path');

// All 15 MVP cities from PRD
const ALL_CITIES = [
  {
    id: "nyc",
    name: "New York City",
    state: "NY",
    country: "US",
    description: "The city that never sleeps - world's most diverse dining scene",
    image_url: "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800",
    timezone: "America/New_York",
    coordinates: { lat: 40.7128, lng: -74.006 }
  },
  {
    id: "la",
    name: "Los Angeles",
    state: "CA",
    country: "US",
    description: "City of Angels - taco trucks to Michelin stars",
    image_url: "https://images.unsplash.com/photo-1534190760961-74e8c1c5c3da?w=800",
    timezone: "America/Los_Angeles",
    coordinates: { lat: 34.0522, lng: -118.2437 }
  },
  {
    id: "chicago",
    name: "Chicago",
    state: "IL",
    country: "US",
    description: "The Windy City - deep dish, steakhouses, and neighborhood gems",
    image_url: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800",
    timezone: "America/Chicago",
    coordinates: { lat: 41.8781, lng: -87.6298 }
  },
  {
    id: "sf",
    name: "San Francisco",
    state: "CA",
    country: "US",
    description: "Bay Area food scene - farm-to-table pioneers and global flavors",
    image_url: "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=800",
    timezone: "America/Los_Angeles",
    coordinates: { lat: 37.7749, lng: -122.4194 }
  },
  {
    id: "houston",
    name: "Houston",
    state: "TX",
    country: "US",
    description: "America's most diverse city - incredible international food scene",
    image_url: "https://images.unsplash.com/photo-1530089711124-9ca31fb9e863?w=800",
    timezone: "America/Chicago",
    coordinates: { lat: 29.7604, lng: -95.3698 }
  },
  {
    id: "miami",
    name: "Miami",
    state: "FL",
    country: "US",
    description: "Magic City - Latin flavors, seafood, and South Beach vibes",
    image_url: "https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=800",
    timezone: "America/New_York",
    coordinates: { lat: 25.7617, lng: -80.1918 }
  },
  {
    id: "austin",
    name: "Austin",
    state: "TX",
    country: "US",
    description: "Keep Austin Weird - BBQ capital and food truck paradise",
    image_url: "https://images.unsplash.com/photo-1531218150217-54595bc2b934?w=800",
    timezone: "America/Chicago",
    coordinates: { lat: 30.2672, lng: -97.7431 }
  },
  {
    id: "vegas",
    name: "Las Vegas",
    state: "NV",
    country: "US",
    description: "Entertainment Capital - celebrity chef restaurants and late-night eats",
    image_url: "https://images.unsplash.com/photo-1605833556294-ea5c7a74f57d?w=800",
    timezone: "America/Los_Angeles",
    coordinates: { lat: 36.1699, lng: -115.1398 }
  },
  {
    id: "philly",
    name: "Philadelphia",
    state: "PA",
    country: "US",
    description: "City of Brotherly Love - cheesesteaks, hoagies, and BYOBs",
    image_url: "https://images.unsplash.com/photo-1569761316261-9a8696fa2ca3?w=800",
    timezone: "America/New_York",
    coordinates: { lat: 39.9526, lng: -75.1652 }
  },
  {
    id: "seattle",
    name: "Seattle",
    state: "WA",
    country: "US",
    description: "Emerald City - coffee culture, seafood, and Pacific Rim cuisine",
    image_url: "https://images.unsplash.com/photo-1502175353174-a7a70e73b362?w=800",
    timezone: "America/Los_Angeles",
    coordinates: { lat: 47.6062, lng: -122.3321 }
  },
  {
    id: "nola",
    name: "New Orleans",
    state: "LA",
    country: "US",
    description: "The Big Easy - Creole, Cajun, and America's best food city",
    image_url: "https://images.unsplash.com/photo-1568402102990-bc541580b59f?w=800",
    timezone: "America/Chicago",
    coordinates: { lat: 29.9511, lng: -90.0715 }
  },
  {
    id: "boston",
    name: "Boston",
    state: "MA",
    country: "US",
    description: "Historic foodie hub - seafood, Italian, and innovative dining",
    image_url: "https://images.unsplash.com/photo-1501979376754-1d09c834c416?w=800",
    timezone: "America/New_York",
    coordinates: { lat: 42.3601, lng: -71.0589 }
  },
  {
    id: "dc",
    name: "Washington, DC",
    state: "DC",
    country: "US",
    description: "Nation's Capital - embassy row cuisines and power dining",
    image_url: "https://images.unsplash.com/photo-1501466044931-62695aada8e9?w=800",
    timezone: "America/New_York",
    coordinates: { lat: 38.9072, lng: -77.0369 }
  },
  {
    id: "nashville",
    name: "Nashville",
    state: "TN",
    country: "US",
    description: "Music City - hot chicken, honky tonks, and Southern hospitality",
    image_url: "https://images.unsplash.com/photo-1545419913-775e3e73a753?w=800",
    timezone: "America/Chicago",
    coordinates: { lat: 36.1627, lng: -86.7816 }
  },
  {
    id: "portland",
    name: "Portland",
    state: "OR",
    country: "US",
    description: "Keep Portland Weird - food carts, craft everything, and farm-fresh",
    image_url: "https://images.unsplash.com/photo-1507608616759-54f48f0af0ee?w=800",
    timezone: "America/Los_Angeles",
    coordinates: { lat: 45.5152, lng: -122.6784 }
  }
];

// Full taxonomy from LIST_TAXONOMY.md
const taxonomy = {
  cuisines: {
    "Italian": ["Red Sauce Italian", "Coastal Seafood Italian", "Northern Alpine Italian", "Tuscan Steakhouse / Griglia", "Rustic Countryside Italian"],
    "Chinese": ["Sichuan / Chengdu", "Cantonese / Dim Sum", "Shanghai / Xiaolongbao", "Hunan / Xiang", "Northern Noodle & Dumpling Houses"],
    "Mexican": ["Street Tacos & Taquerias", "Birria & Regional Jalisco-Style", "Elevated Fine Dining Mexican", "Mariscos / Coastal Mexican", "Home-Style Comida Corrida"],
    "Japanese": ["Sushi & Sashimi Bars", "Ramen Shops", "Izakayas", "Binchotan / Yakitori Grills", "Katsu & Curry Houses"],
    "Indian": ["North Indian / Punjabi", "South Indian", "Hyderabadi / Biryani Houses", "Indo-Chinese", "Vegetarian Thali / Home-Style"],
    "Thai": ["Bangkok Street Thai", "Northern Thai / Isaan", "Southern / Coastal Thai", "Royal / Refined Thai", "Modern Thai Fusion"],
    "French": ["Classic Bistro", "Haute Cuisine / Fine Dining", "Provençal / Coastal", "Patisserie & Boulangerie", "Rustic Countryside / Bistronomy"],
    "Greek": ["Classic Taverna", "Island / Seafood Greek", "Gyro & Souvlaki Shops", "Modern Greek / Neo-Taverna"],
    "American": ["Classic Diner & Comfort", "BBQ & Smokehouse", "Modern American / New American", "Fast-Casual Burgers & Fried Chicken", "Soul Food & Southern Comfort"],
    "Spanish": ["Tapas & Pintxos Bars", "Paella & Rice Houses", "Basque / Northern Spanish", "Modern Spanish / Gastrobar"],
    "Korean": ["Korean BBQ", "K-BBQ + Drinking Joints", "Korean Fried Chicken & Street Snacks", "Homestyle / Banchan-Driven", "Modern Korean / New Korean"],
    "Vietnamese": ["Pho Houses", "Banh Mi & Street Snacks", "Bun / Vermicelli & Rice Plates", "Modern Vietnamese / Elevated"],
    "Middle Eastern": ["Lebanese", "Turkish", "Moroccan", "Levantine"],
    "Brazilian": ["Churrascaria / Rodizio", "Feijoada & Homestyle", "Coastal / Bahian"],
    "Peruvian": ["Nikkei", "Cevicheria", "Andean / Rustic Peruvian"],
    "Ethiopian": ["Classic Injera & Wot Houses", "Vegan / Vegetarian Ethiopian"],
    "Caribbean": ["Jamaican Jerk & Grill", "Islands Seafood & Rum Bars"],
    "Mediterranean": ["Pan-Med Small Plates", "Health-Focused Mediterranean"],
    "Southern": ["Low Country & Coastal Southern", "Classic Meat-and-Three", "Modern Southern"]
  },
  
  signature_dishes: [
    "Pizza", "Hamburger", "French Fries", "Ice Cream", "Fried Chicken",
    "Steak", "Sushi", "Tacos", "Pasta", "Burrito", "Ramen", "Coffee",
    "Hot Dog", "Mac and Cheese", "Dumplings", "Curry", "Fried Rice",
    "Pho", "Lasagna", "Donuts", "Chocolate Cake", "Roast Chicken",
    "Kebab", "Biryani", "Pad Thai", "Dim Sum", "Falafel", "Hummus",
    "Croissant", "Meatballs", "Paella", "Peking Duck", "Breakfast Burrito",
    "Grilled Cheese", "Philly Cheesesteak"
  ],
  
  occasions: [
    "Date Night", "Power Lunch", "Happy Hour", "Family Dinner",
    "Birthday Celebration", "Brunch", "Business Meeting", "Anniversary Dinner",
    "Weekend Getaway Meal", "Holiday Gathering", "Girls' Night Out",
    "Casual Catch-Up", "Romantic Dinner", "Solo Dining", "Group Celebration"
  ]
};

// Image templates for list covers
const imageTemplates = {
  // Cuisines
  "Italian": "https://images.unsplash.com/photo-1498579150354-977475b7ea0b?w=800",
  "Chinese": "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800",
  "Mexican": "https://images.unsplash.com/photo-1613514785940-daed07799d9b?w=800",
  "Japanese": "https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=800",
  "Indian": "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=800",
  "Thai": "https://images.unsplash.com/photo-1559314809-0d155014e29e?w=800",
  "French": "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800",
  "Greek": "https://images.unsplash.com/photo-1544124065-ac0c7cc3a57c?w=800",
  "American": "https://images.unsplash.com/photo-1550547660-d9450f859349?w=800",
  "Spanish": "https://images.unsplash.com/photo-1515443961218-a51367888e4b?w=800",
  "Korean": "https://images.unsplash.com/photo-1590301157890-4810ed352733?w=800",
  "Vietnamese": "https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=800",
  "Middle Eastern": "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=800",
  "Brazilian": "https://images.unsplash.com/photo-1594041680534-e8c8cdebd659?w=800",
  "Mediterranean": "https://images.unsplash.com/photo-1544025162-d76978f8e4de?w=800",
  "Peruvian": "https://images.unsplash.com/photo-1535399831218-d5bd36d1a6b3?w=800",
  "Ethiopian": "https://images.unsplash.com/photo-1604329760661-e71dc83f8f26?w=800",
  "Caribbean": "https://images.unsplash.com/photo-1534939561126-855b8675edd7?w=800",
  "Southern": "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800",
  
  // Signature Dishes
  "Pizza": "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800",
  "Hamburger": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800",
  "Sushi": "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800",
  "Tacos": "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800",
  "Ramen": "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800",
  "Steak": "https://images.unsplash.com/photo-1600891964092-4316c288032e?w=800",
  "Fried Chicken": "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=800",
  "Coffee": "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800",
  "Pasta": "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=800",
  "Burrito": "https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=800",
  "Pho": "https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=800",
  "Dumplings": "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800",
  "Ice Cream": "https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=800",
  "Hot Dog": "https://images.unsplash.com/photo-1612392062631-94e4f1a56ed7?w=800",
  "Donuts": "https://images.unsplash.com/photo-1551024601-bec78aea704b?w=800",
  
  // Occasions
  "Date Night": "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800",
  "Happy Hour": "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800",
  "Brunch": "https://images.unsplash.com/photo-1504754524776-8f4f37790ca0?w=800",
  "Business Meeting": "https://images.unsplash.com/photo-1497366216548-37526070297c?w=800",
  "Family Dinner": "https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=800",
  "Birthday Celebration": "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=800",
  "Power Lunch": "https://images.unsplash.com/photo-1567521464027-f127ff144326?w=800",
  "Anniversary Dinner": "https://images.unsplash.com/photo-1529543544277-750e2990eff0?w=800",
  "Girls' Night Out": "https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=800",
  "Solo Dining": "https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=800"
};

function getImageUrl(category) {
  return imageTemplates[category] || 
    `https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800`; // Default restaurant image
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function generateListId(cityId, category, subcategory = null) {
  const base = subcategory ? `${category}-${subcategory}` : category;
  return `list_${cityId}_${slugify(base)}`;
}

function ensureAllCities(seedData) {
  const existingCityIds = new Set(seedData.cities.map(c => c.id));
  let addedCount = 0;
  
  for (const city of ALL_CITIES) {
    if (!existingCityIds.has(city.id)) {
      seedData.cities.push(city);
      addedCount++;
      console.log(`  ➕ Added city: ${city.name}`);
    }
  }
  
  return addedCount;
}

function generateLists(cities, existingLists) {
  const existingIds = new Set(existingLists.map(l => l.id));
  const newLists = [];
  
  for (const city of cities) {
    const cityId = city.id;
    const cityName = city.name;
    
    // Generate cuisine lists
    for (const [cuisine, subcuisines] of Object.entries(taxonomy.cuisines)) {
      // Parent cuisine list
      const parentId = generateListId(cityId, cuisine);
      if (!existingIds.has(parentId)) {
        newLists.push({
          id: parentId,
          name: `Best ${cuisine} in ${cityName}`,
          city_id: cityId,
          scope: 'city',
          category: cuisine,
          category_type: 'cuisine',
          description: `Top ${cuisine.toLowerCase()} restaurants in ${cityName}`,
          curator: 'Localist Team',
          is_featured: ['Italian', 'Japanese', 'Mexican', 'Chinese', 'American'].includes(cuisine),
          image_url: getImageUrl(cuisine)
        });
        existingIds.add(parentId);
      }
      
      // Sub-cuisine lists (only for top cuisines to avoid overwhelming)
      if (['Italian', 'Chinese', 'Japanese', 'Mexican', 'American'].includes(cuisine)) {
        for (const subcuisine of subcuisines) {
          const subId = generateListId(cityId, cuisine, subcuisine);
          if (!existingIds.has(subId)) {
            newLists.push({
              id: subId,
              name: `Best ${subcuisine} in ${cityName}`,
              city_id: cityId,
              scope: 'city',
              category: cuisine,
              subcategory: subcuisine,
              category_type: 'cuisine',
              description: `${subcuisine} spots in ${cityName}`,
              curator: 'Localist Team',
              is_featured: false,
              image_url: getImageUrl(cuisine)
            });
            existingIds.add(subId);
          }
        }
      }
    }
    
    // Generate signature dish lists (top 20 only for MVP)
    const topDishes = taxonomy.signature_dishes.slice(0, 20);
    for (const dish of topDishes) {
      const dishId = generateListId(cityId, dish);
      if (!existingIds.has(dishId)) {
        newLists.push({
          id: dishId,
          name: `Best ${dish} in ${cityName}`,
          city_id: cityId,
          scope: 'city',
          category: dish,
          category_type: 'signature_dish',
          description: `Where to find the best ${dish.toLowerCase()} in ${cityName}`,
          curator: 'Localist Team',
          is_featured: ['Pizza', 'Hamburger', 'Sushi', 'Tacos', 'Ramen'].includes(dish),
          image_url: getImageUrl(dish)
        });
        existingIds.add(dishId);
      }
    }
    
    // Generate occasion lists
    for (const occasion of taxonomy.occasions) {
      const occasionId = generateListId(cityId, occasion);
      if (!existingIds.has(occasionId)) {
        newLists.push({
          id: occasionId,
          name: `Best ${occasion} Spots in ${cityName}`,
          city_id: cityId,
          scope: 'city',
          category: occasion,
          category_type: 'occasion',
          description: `Top places for ${occasion.toLowerCase()} in ${cityName}`,
          curator: 'Localist Team',
          is_featured: ['Date Night', 'Brunch', 'Happy Hour'].includes(occasion),
          image_url: getImageUrl(occasion)
        });
        existingIds.add(occasionId);
      }
    }
  }
  
  return newLists;
}

function main() {
  const seedDataPath = path.join(__dirname, '../data/seed-data.json');
  
  console.log('📂 Reading seed-data.json...');
  const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));
  
  console.log(`📊 Current: ${seedData.cities.length} cities, ${seedData.lists.length} lists`);
  
  // Ensure all 15 cities exist
  console.log('\n🏙️  Ensuring all 15 MVP cities exist...');
  const citiesAdded = ensureAllCities(seedData);
  if (citiesAdded > 0) {
    console.log(`  ✅ Added ${citiesAdded} new cities`);
  } else {
    console.log('  ✅ All 15 cities already present');
  }
  
  // Generate new lists for ALL cities
  console.log('\n📋 Generating lists for all cities...');
  const newLists = generateLists(seedData.cities, seedData.lists);
  console.log(`  ➕ Generated ${newLists.length} new lists`);
  
  // Merge lists (existing + new)
  seedData.lists = [...seedData.lists, ...newLists];
  
  console.log(`\n📊 Updated: ${seedData.cities.length} cities, ${seedData.lists.length} total lists`);
  
  // Write back
  fs.writeFileSync(seedDataPath, JSON.stringify(seedData, null, 2));
  console.log('✅ Updated seed-data.json');
  
  // Summary by city
  console.log('\n📋 Lists per city:');
  const cityListCounts = {};
  for (const list of seedData.lists) {
    cityListCounts[list.city_id] = (cityListCounts[list.city_id] || 0) + 1;
  }
  
  // Sort by city name
  const cityMap = {};
  for (const city of seedData.cities) {
    cityMap[city.id] = city.name;
  }
  
  const sortedEntries = Object.entries(cityListCounts).sort((a, b) => 
    (cityMap[a[0]] || a[0]).localeCompare(cityMap[b[0]] || b[0])
  );
  
  for (const [cityId, count] of sortedEntries) {
    console.log(`   ${cityMap[cityId] || cityId}: ${count} lists`);
  }
  
  // Category breakdown
  console.log('\n📊 Lists by category type:');
  const categoryTypes = {};
  for (const list of seedData.lists) {
    const type = list.category_type || 'other';
    categoryTypes[type] = (categoryTypes[type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(categoryTypes)) {
    console.log(`   ${type}: ${count}`);
  }
}

main();
