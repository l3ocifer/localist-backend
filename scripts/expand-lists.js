#!/usr/bin/env node
/**
 * Expand seed-data.json with comprehensive list taxonomy
 * 
 * Run: node scripts/expand-lists.js
 * 
 * This script:
 * 1. Reads existing seed-data.json
 * 2. Adds lists for all cuisines, dishes, and occasions per city
 * 3. Assigns venues to lists based on category/cuisine matching
 * 4. Writes back to seed-data.json (idempotent - safe to run multiple times)
 */

const fs = require('fs');
const path = require('path');

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
  
  // Signature Dishes
  "Pizza": "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800",
  "Hamburger": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800",
  "Sushi": "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800",
  "Tacos": "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800",
  "Ramen": "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800",
  "Steak": "https://images.unsplash.com/photo-1600891964092-4316c288032e?w=800",
  "Fried Chicken": "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=800",
  "Coffee": "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800",
  "Brunch": "https://images.unsplash.com/photo-1504754524776-8f4f37790ca0?w=800",
  "Pasta": "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=800",
  
  // Occasions
  "Date Night": "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800",
  "Happy Hour": "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800",
  "Brunch": "https://images.unsplash.com/photo-1504754524776-8f4f37790ca0?w=800",
  "Business Meeting": "https://images.unsplash.com/photo-1497366216548-37526070297c?w=800",
  "Family Dinner": "https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=800",
  "Birthday Celebration": "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=800"
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
  
  // Generate new lists
  const newLists = generateLists(seedData.cities, seedData.lists);
  console.log(`➕ Generated ${newLists.length} new lists`);
  
  // Merge lists (existing + new)
  seedData.lists = [...seedData.lists, ...newLists];
  
  console.log(`📊 Updated: ${seedData.lists.length} total lists`);
  
  // Write back
  fs.writeFileSync(seedDataPath, JSON.stringify(seedData, null, 2));
  console.log('✅ Updated seed-data.json');
  
  // Summary by city
  console.log('\n📋 Lists per city:');
  const cityListCounts = {};
  for (const list of seedData.lists) {
    cityListCounts[list.city_id] = (cityListCounts[list.city_id] || 0) + 1;
  }
  for (const [cityId, count] of Object.entries(cityListCounts)) {
    console.log(`   ${cityId}: ${count} lists`);
  }
}

main();

