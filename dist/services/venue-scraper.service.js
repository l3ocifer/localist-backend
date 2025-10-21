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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VenueScraperService = void 0;
const axios_1 = __importDefault(require("axios"));
const database_1 = __importDefault(require("../config/database"));
const uuid_1 = require("uuid");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
class VenueScraperService {
    static instance;
    isRunning = false;
    lastRunTime = null;
    googleApiKey;
    yelpApiKey;
    foursquareApiKey;
    constructor() {
        this.googleApiKey = process.env.GOOGLE_PLACES_API_KEY || '';
        this.yelpApiKey = process.env.YELP_API_KEY || '';
        this.foursquareApiKey = process.env.FOURSQUARE_API_KEY || '';
    }
    static getInstance() {
        if (!VenueScraperService.instance) {
            VenueScraperService.instance = new VenueScraperService();
        }
        return VenueScraperService.instance;
    }
    /**
     * Main scraper method - runs periodically to fetch new venues
     */
    async scrapeVenues(cityId, category) {
        if (this.isRunning) {
            console.log('Scraper is already running, skipping...');
            return 0;
        }
        this.isRunning = true;
        let venuesAdded = 0;
        try {
            console.log(`🔍 Starting venue scraping for ${cityId}...`);
            // Get city details
            const cityResult = await database_1.default.query('SELECT * FROM cities WHERE id = $1', [cityId]);
            if (cityResult.rows.length === 0) {
                throw new Error(`City ${cityId} not found`);
            }
            const city = cityResult.rows[0];
            // Scrape from multiple sources
            const allVenues = [];
            if (this.googleApiKey) {
                const googlePlaces = await this.scrapeGooglePlaces(city, category);
                allVenues.push(...googlePlaces);
                console.log(`  ✓ Google Places: ${googlePlaces.length} venues found`);
            }
            if (this.yelpApiKey) {
                const yelpVenues = await this.scrapeYelp(city, category);
                allVenues.push(...yelpVenues);
                console.log(`  ✓ Yelp: ${yelpVenues.length} venues found`);
            }
            if (this.foursquareApiKey) {
                const foursquareVenues = await this.scrapeFoursquare(city, category);
                allVenues.push(...foursquareVenues);
                console.log(`  ✓ Foursquare: ${foursquareVenues.length} venues found`);
            }
            if (allVenues.length === 0) {
                console.warn('⚠️ No API keys configured or no venues found. Please add API keys to .env file.');
                return 0;
            }
            // Deduplicate venues
            const uniqueVenues = this.deduplicateVenues(allVenues);
            console.log(`  📊 Total unique venues after deduplication: ${uniqueVenues.length}`);
            // Save venues to database
            for (const venue of uniqueVenues) {
                const saved = await this.saveVenue(venue, cityId);
                if (saved)
                    venuesAdded++;
            }
            console.log(`✅ Added ${venuesAdded} new venues for ${cityId}`);
            this.lastRunTime = new Date();
        }
        catch (error) {
            console.error('❌ Scraper error:', error);
        }
        finally {
            this.isRunning = false;
        }
        return venuesAdded;
    }
    /**
     * Google Places API scraper
     */
    async scrapeGooglePlaces(city, category) {
        if (!this.googleApiKey) {
            console.log('  ⚠️ Google Places API key not configured');
            return [];
        }
        const venues = [];
        const baseUrl = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
        // Map our categories to Google Places types
        const categoryToTypes = {
            'restaurant': ['restaurant'],
            'bar': ['bar', 'night_club'],
            'cafe': ['cafe', 'bakery'],
            'nightclub': ['night_club'],
            'shopping': ['shopping_mall', 'store', 'clothing_store'],
            'entertainment': ['movie_theater', 'museum', 'art_gallery'],
            'fitness': ['gym', 'spa'],
            'hotel': ['lodging', 'hotel']
        };
        const types = category ? (categoryToTypes[category] || ['establishment']) : ['restaurant', 'bar', 'cafe'];
        const lat = city.coordinates?.lat || city.latitude;
        const lng = city.coordinates?.lng || city.longitude;
        if (!lat || !lng) {
            console.warn(`  ⚠️ No coordinates found for ${city.name}`);
            return venues;
        }
        for (const type of types) {
            try {
                let nextPageToken;
                let pageCount = 0;
                const maxPages = 3; // Google allows max 3 pages (60 results)
                do {
                    const params = {
                        location: `${lat},${lng}`,
                        radius: 5000, // 5km radius
                        type,
                        key: this.googleApiKey
                    };
                    if (nextPageToken) {
                        params.pagetoken = nextPageToken;
                        // Google requires a short delay before using next page token
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    const response = await axios_1.default.get(baseUrl, { params });
                    const results = response.data.results || [];
                    for (const place of results) {
                        const venue = await this.transformGooglePlace(place, category || type);
                        venues.push(venue);
                    }
                    nextPageToken = response.data.next_page_token;
                    pageCount++;
                } while (nextPageToken && pageCount < maxPages);
            }
            catch (error) {
                console.error(`  ❌ Google Places API error for type ${type}:`, error.response?.data?.error_message || error.message);
            }
        }
        return venues;
    }
    /**
     * Transform Google Place to our venue format
     */
    async transformGooglePlace(place, category) {
        // Get photo URL if available
        let imageUrl;
        if (place.photos && place.photos.length > 0 && this.googleApiKey) {
            const photoRef = place.photos[0].photo_reference;
            imageUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${this.googleApiKey}`;
        }
        // Try to get more details if needed
        let phone;
        let website;
        let hours = {};
        // Get additional details from Place Details API
        if (this.googleApiKey) {
            try {
                const detailsUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
                const detailsResponse = await axios_1.default.get(detailsUrl, {
                    params: {
                        place_id: place.place_id,
                        fields: 'formatted_phone_number,website,opening_hours',
                        key: this.googleApiKey
                    }
                });
                if (detailsResponse.data.result) {
                    phone = detailsResponse.data.result.formatted_phone_number;
                    website = detailsResponse.data.result.website;
                    // Parse opening hours
                    if (detailsResponse.data.result.opening_hours?.weekday_text) {
                        const weekdayText = detailsResponse.data.result.opening_hours.weekday_text;
                        hours = this.parseGoogleHours(weekdayText);
                    }
                }
            }
            catch (error) {
                // Details API call failed, continue without additional info
                console.debug(`Could not fetch details for ${place.name}`);
            }
        }
        // Extract features from types
        const features = this.extractFeaturesFromTypes(place.types);
        return {
            name: place.name,
            address: place.vicinity,
            category: this.normalizeCategory(category),
            rating: place.rating,
            price_level: place.price_level,
            phone,
            website,
            hours,
            coordinates: {
                lat: place.geometry.location.lat,
                lng: place.geometry.location.lng
            },
            features,
            image_url: imageUrl,
            description: `Popular ${category} in the area`,
            place_id: place.place_id,
            source: 'Google Places'
        };
    }
    /**
     * Parse Google's weekday_text format into our hours format
     */
    parseGoogleHours(weekdayText) {
        const hours = {};
        const dayMap = {
            'Monday': 'monday',
            'Tuesday': 'tuesday',
            'Wednesday': 'wednesday',
            'Thursday': 'thursday',
            'Friday': 'friday',
            'Saturday': 'saturday',
            'Sunday': 'sunday'
        };
        for (const text of weekdayText) {
            // Format: "Monday: 11:00 AM – 10:00 PM" or "Monday: Closed"
            const parts = text.split(': ');
            if (parts.length === 2) {
                const day = dayMap[parts[0]];
                if (day) {
                    if (parts[1].toLowerCase() === 'closed') {
                        hours[day] = { open: null, close: null };
                    }
                    else {
                        // Parse hours (simplified - you may want more robust parsing)
                        const timeParts = parts[1].split(' – ');
                        if (timeParts.length === 2) {
                            hours[day] = {
                                open: this.convertTo24Hour(timeParts[0]),
                                close: this.convertTo24Hour(timeParts[1])
                            };
                        }
                    }
                }
            }
        }
        return hours;
    }
    /**
     * Convert 12-hour time to 24-hour format
     */
    convertTo24Hour(time12h) {
        const [time, modifier] = time12h.split(' ');
        let [hours, minutes] = time.split(':');
        if (hours === '12') {
            hours = '00';
        }
        if (modifier === 'PM') {
            hours = String(parseInt(hours, 10) + 12);
        }
        return `${hours}:${minutes}`;
    }
    /**
     * Yelp Fusion API scraper
     */
    async scrapeYelp(city, category) {
        if (!this.yelpApiKey) {
            console.log('  ⚠️ Yelp API key not configured');
            return [];
        }
        const venues = [];
        const baseUrl = 'https://api.yelp.com/v3/businesses/search';
        // Map our categories to Yelp categories
        const categoryToYelp = {
            'restaurant': 'restaurants',
            'bar': 'bars',
            'cafe': 'coffee',
            'nightclub': 'nightlife',
            'shopping': 'shopping',
            'entertainment': 'arts',
            'fitness': 'fitness',
            'hotel': 'hotels'
        };
        const yelpCategory = category ? categoryToYelp[category] : null;
        const lat = city.coordinates?.lat || city.latitude;
        const lng = city.coordinates?.lng || city.longitude;
        if (!lat || !lng) {
            console.warn(`  ⚠️ No coordinates found for ${city.name}`);
            return venues;
        }
        try {
            let offset = 0;
            const limit = 50; // Yelp max per request
            const maxResults = 200; // Limit total results to avoid excessive API calls
            while (offset < maxResults) {
                const params = {
                    latitude: lat,
                    longitude: lng,
                    radius: 5000, // 5km radius
                    limit,
                    offset
                };
                if (yelpCategory) {
                    params.categories = yelpCategory;
                }
                const response = await axios_1.default.get(baseUrl, {
                    headers: {
                        'Authorization': `Bearer ${this.yelpApiKey}`
                    },
                    params
                });
                const businesses = response.data.businesses || [];
                if (businesses.length === 0)
                    break;
                for (const business of businesses) {
                    const venue = this.transformYelpBusiness(business);
                    venues.push(venue);
                }
                offset += limit;
                // Rate limit protection
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        catch (error) {
            console.error('  ❌ Yelp API error:', error.response?.data?.error?.description || error.message);
        }
        return venues;
    }
    /**
     * Transform Yelp business to our venue format
     */
    transformYelpBusiness(business) {
        // Parse price level ($ = 1, $$ = 2, etc.)
        const priceLevel = business.price ? business.price.length : undefined;
        // Extract main category
        const category = business.categories.length > 0
            ? this.normalizeCategory(business.categories[0].alias)
            : 'restaurant';
        // Parse hours if available
        let hours = {};
        if (business.hours && business.hours.length > 0) {
            hours = this.parseYelpHours(business.hours[0].open);
        }
        // Extract features based on categories
        const features = [];
        if (business.categories.some(c => c.alias.includes('vegan')))
            features.push('vegan options');
        if (business.categories.some(c => c.alias.includes('gluten')))
            features.push('gluten free options');
        if (business.categories.some(c => c.alias.includes('outdoor')))
            features.push('outdoor seating');
        if (business.categories.some(c => c.alias.includes('delivery')))
            features.push('delivery');
        if (business.categories.some(c => c.alias.includes('takeout')))
            features.push('takeout');
        return {
            name: business.name,
            address: business.location.display_address.join(', '),
            category,
            rating: business.rating,
            price_level: priceLevel,
            phone: business.phone,
            website: business.url,
            hours,
            coordinates: {
                lat: business.coordinates.latitude,
                lng: business.coordinates.longitude
            },
            features,
            image_url: business.image_url,
            description: `${business.categories.map(c => c.title).join(', ')}`,
            place_id: business.id,
            source: 'Yelp'
        };
    }
    /**
     * Parse Yelp hours format
     */
    parseYelpHours(yelpHours) {
        const hours = {};
        const dayMap = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        // Initialize all days as closed
        dayMap.forEach(day => {
            hours[day] = { open: null, close: null };
        });
        // Update with actual hours
        for (const slot of yelpHours) {
            const day = dayMap[slot.day];
            if (day) {
                hours[day] = {
                    open: this.formatYelpTime(slot.start),
                    close: this.formatYelpTime(slot.end)
                };
            }
        }
        return hours;
    }
    /**
     * Format Yelp time (HHMM) to HH:MM
     */
    formatYelpTime(time) {
        if (!time || time.length !== 4)
            return '00:00';
        return `${time.substring(0, 2)}:${time.substring(2, 4)}`;
    }
    /**
     * Foursquare API scraper
     */
    async scrapeFoursquare(city, category) {
        if (!this.foursquareApiKey) {
            console.log('  ⚠️ Foursquare API key not configured');
            return [];
        }
        const venues = [];
        const baseUrl = 'https://api.foursquare.com/v3/places/search';
        // Map our categories to Foursquare categories
        const categoryToFoursquare = {
            'restaurant': '13065', // Dining and Drinking > Restaurant
            'bar': '13003', // Dining and Drinking > Bar
            'cafe': '13032', // Dining and Drinking > Cafe
            'nightclub': '13039', // Dining and Drinking > Nightclub
            'shopping': '17000', // Retail
            'entertainment': '10000', // Arts and Entertainment
            'fitness': '18021', // Sports and Recreation > Gym
            'hotel': '19014' // Travel and Transportation > Hotel
        };
        const fsqCategory = category ? categoryToFoursquare[category] : null;
        const lat = city.coordinates?.lat || city.latitude;
        const lng = city.coordinates?.lng || city.longitude;
        if (!lat || !lng) {
            console.warn(`  ⚠️ No coordinates found for ${city.name}`);
            return venues;
        }
        try {
            const params = {
                ll: `${lat},${lng}`,
                radius: 5000, // 5km radius
                limit: 50 // Foursquare max per request
            };
            if (fsqCategory) {
                params.categories = fsqCategory;
            }
            const response = await axios_1.default.get(baseUrl, {
                headers: {
                    'Authorization': this.foursquareApiKey,
                    'Accept': 'application/json'
                },
                params
            });
            const results = response.data.results || [];
            for (const place of results) {
                const venue = await this.transformFoursquareVenue(place);
                venues.push(venue);
            }
        }
        catch (error) {
            console.error('  ❌ Foursquare API error:', error.response?.data?.message || error.message);
        }
        return venues;
    }
    /**
     * Transform Foursquare venue to our format
     */
    async transformFoursquareVenue(venue) {
        // Get photo URL if available
        let imageUrl;
        if (venue.photos && venue.photos.length > 0) {
            const photo = venue.photos[0];
            imageUrl = `${photo.prefix}800x600${photo.suffix}`;
        }
        // Extract category
        const category = venue.categories && venue.categories.length > 0
            ? this.normalizeFoursquareCategory(venue.categories[0].name)
            : 'restaurant';
        // Parse hours if available
        const hours = venue.hours?.regular ? this.parseFoursquareHours(venue.hours.regular) : {};
        // Build features list
        const features = [];
        // Foursquare doesn't provide as many feature details, so we'd need additional API calls
        return {
            name: venue.name,
            address: venue.location.formatted_address || venue.location.address || '',
            category,
            rating: venue.rating ? venue.rating / 2 : undefined, // Foursquare uses 0-10 scale
            price_level: venue.price,
            phone: venue.tel,
            website: venue.website,
            hours,
            coordinates: venue.geocodes?.main ? {
                lat: venue.geocodes.main.latitude,
                lng: venue.geocodes.main.longitude
            } : undefined,
            features,
            image_url: imageUrl,
            description: venue.categories?.map(c => c.name).join(', '),
            place_id: venue.fsq_id,
            source: 'Foursquare'
        };
    }
    /**
     * Parse Foursquare hours format
     */
    parseFoursquareHours(fsqHours) {
        const hours = {};
        const dayMap = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        // Initialize all days as closed
        dayMap.forEach(day => {
            hours[day] = { open: null, close: null };
        });
        // Update with actual hours
        for (const slot of fsqHours) {
            const day = dayMap[slot.day - 1]; // Foursquare uses 1-7 for Mon-Sun
            if (day) {
                hours[day] = {
                    open: this.formatFoursquareTime(slot.open),
                    close: this.formatFoursquareTime(slot.close)
                };
            }
        }
        return hours;
    }
    /**
     * Format Foursquare time (HHMM) to HH:MM
     */
    formatFoursquareTime(time) {
        if (!time || time.length !== 4)
            return '00:00';
        return `${time.substring(0, 2)}:${time.substring(2, 4)}`;
    }
    /**
     * Normalize Foursquare category names
     */
    normalizeFoursquareCategory(category) {
        const lowerCategory = category.toLowerCase();
        if (lowerCategory.includes('restaurant') || lowerCategory.includes('food'))
            return 'restaurant';
        if (lowerCategory.includes('bar') || lowerCategory.includes('pub'))
            return 'bar';
        if (lowerCategory.includes('cafe') || lowerCategory.includes('coffee'))
            return 'cafe';
        if (lowerCategory.includes('night') || lowerCategory.includes('club'))
            return 'nightclub';
        if (lowerCategory.includes('shop') || lowerCategory.includes('store'))
            return 'shopping';
        if (lowerCategory.includes('gym') || lowerCategory.includes('fitness'))
            return 'fitness';
        if (lowerCategory.includes('hotel') || lowerCategory.includes('lodging'))
            return 'hotel';
        return 'restaurant'; // default
    }
    /**
     * Extract features from Google Places types
     */
    extractFeaturesFromTypes(types) {
        const features = [];
        const featureMap = {
            'parking': 'parking',
            'wheelchair_accessible': 'wheelchair accessible',
            'delivery': 'delivery',
            'takeout': 'takeout',
            'dine_in': 'dine in',
            'outdoor_seating': 'outdoor seating',
            'wifi': 'wifi',
            'vegetarian_friendly': 'vegetarian options',
            'vegan_friendly': 'vegan options'
        };
        for (const type of types) {
            if (featureMap[type]) {
                features.push(featureMap[type]);
            }
        }
        return features;
    }
    /**
     * Normalize category names across different sources
     */
    normalizeCategory(category) {
        const categoryMap = {
            'restaurants': 'restaurant',
            'food': 'restaurant',
            'dining': 'restaurant',
            'bars': 'bar',
            'pubs': 'bar',
            'drinks': 'bar',
            'coffee': 'cafe',
            'coffeehouse': 'cafe',
            'bakery': 'cafe',
            'nightlife': 'nightclub',
            'club': 'nightclub',
            'shopping': 'shopping',
            'retail': 'shopping',
            'entertainment': 'entertainment',
            'arts': 'entertainment',
            'fitness': 'fitness',
            'gym': 'fitness',
            'sports': 'fitness',
            'hotels': 'hotel',
            'lodging': 'hotel',
            'accommodation': 'hotel'
        };
        return categoryMap[category.toLowerCase()] || category.toLowerCase();
    }
    /**
     * Deduplicate venues based on name and location similarity
     */
    deduplicateVenues(venues) {
        const uniqueVenues = [];
        const seen = new Set();
        for (const venue of venues) {
            // Create a normalized key for comparison
            const key = this.createVenueKey(venue);
            if (!seen.has(key)) {
                seen.add(key);
                // Check for similar venues already added
                const isDuplicate = uniqueVenues.some(existing => this.areSimilarVenues(existing, venue));
                if (!isDuplicate) {
                    // Merge data from multiple sources if available
                    const existingIndex = uniqueVenues.findIndex(v => this.areSameVenue(v, venue));
                    if (existingIndex >= 0) {
                        uniqueVenues[existingIndex] = this.mergeVenueData(uniqueVenues[existingIndex], venue);
                    }
                    else {
                        uniqueVenues.push(venue);
                    }
                }
            }
        }
        return uniqueVenues;
    }
    /**
     * Create a normalized key for venue comparison
     */
    createVenueKey(venue) {
        const name = venue.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const address = venue.address.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
        return `${name}_${address}`;
    }
    /**
     * Check if two venues are similar (likely duplicates)
     */
    areSimilarVenues(venue1, venue2) {
        // Check name similarity
        const name1 = venue1.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const name2 = venue2.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const nameSimilarity = this.calculateSimilarity(name1, name2);
        if (nameSimilarity < 0.8)
            return false;
        // Check location proximity (if coordinates available)
        if (venue1.coordinates && venue2.coordinates) {
            const distance = this.calculateDistance(venue1.coordinates.lat, venue1.coordinates.lng, venue2.coordinates.lat, venue2.coordinates.lng);
            // Consider venues within 100 meters as potential duplicates
            return distance < 0.1;
        }
        // Check address similarity if no coordinates
        const addr1 = venue1.address.toLowerCase().replace(/[^a-z0-9]/g, '');
        const addr2 = venue2.address.toLowerCase().replace(/[^a-z0-9]/g, '');
        return this.calculateSimilarity(addr1, addr2) > 0.7;
    }
    /**
     * Check if two venues are the same (exact match from different sources)
     */
    areSameVenue(venue1, venue2) {
        // If they have the same place_id from the same source
        if (venue1.place_id && venue2.place_id &&
            venue1.place_id === venue2.place_id &&
            venue1.source === venue2.source) {
            return true;
        }
        // Otherwise check for very high similarity
        return this.areSimilarVenues(venue1, venue2);
    }
    /**
     * Merge data from multiple sources for the same venue
     */
    mergeVenueData(existing, newVenue) {
        return {
            ...existing,
            // Prefer non-null values
            phone: existing.phone || newVenue.phone,
            website: existing.website || newVenue.website,
            image_url: existing.image_url || newVenue.image_url,
            description: existing.description || newVenue.description,
            // Average ratings if both present
            rating: existing.rating && newVenue.rating
                ? (existing.rating + newVenue.rating) / 2
                : existing.rating || newVenue.rating,
            // Merge features
            features: [...new Set([...(existing.features || []), ...(newVenue.features || [])])],
            // Keep the most complete hours
            hours: Object.keys(existing.hours || {}).length > Object.keys(newVenue.hours || {}).length
                ? existing.hours
                : newVenue.hours,
            // Combine sources
            source: existing.source === newVenue.source
                ? existing.source
                : `${existing.source}, ${newVenue.source}`
        };
    }
    /**
     * Calculate string similarity (Levenshtein distance based)
     */
    calculateSimilarity(str1, str2) {
        const maxLen = Math.max(str1.length, str2.length);
        if (maxLen === 0)
            return 1;
        const distance = this.levenshteinDistance(str1, str2);
        return 1 - (distance / maxLen);
    }
    /**
     * Calculate Levenshtein distance between two strings
     */
    levenshteinDistance(str1, str2) {
        const m = str1.length;
        const n = str2.length;
        const dp = [];
        for (let i = 0; i <= m; i++) {
            dp[i] = [i];
        }
        for (let j = 0; j <= n; j++) {
            dp[0][j] = j;
        }
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                }
                else {
                    dp[i][j] = Math.min(dp[i - 1][j] + 1, // deletion
                    dp[i][j - 1] + 1, // insertion
                    dp[i - 1][j - 1] + 1 // substitution
                    );
                }
            }
        }
        return dp[m][n];
    }
    /**
     * Calculate distance between two coordinates in kilometers
     */
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = this.toRad(lat2 - lat1);
        const dLng = this.toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    /**
     * Convert degrees to radians
     */
    toRad(deg) {
        return deg * (Math.PI / 180);
    }
    /**
     * Save venue to database if it doesn't exist
     */
    async saveVenue(venue, cityId) {
        try {
            // Check if venue already exists (by name and coordinates)
            let existing;
            if (venue.coordinates) {
                // Check by coordinates proximity and similar name
                existing = await database_1.default.query(`SELECT id FROM venues
           WHERE city_id = $1
           AND (
             (LOWER(name) = LOWER($2)) OR
             (coordinates IS NOT NULL AND
              ABS((coordinates->>'lat')::float - $3) < 0.001 AND
              ABS((coordinates->>'lng')::float - $4) < 0.001)
           )`, [cityId, venue.name, venue.coordinates.lat, venue.coordinates.lng]);
            }
            else {
                // Just check by name if no coordinates
                existing = await database_1.default.query('SELECT id FROM venues WHERE LOWER(name) = LOWER($1) AND city_id = $2', [venue.name, cityId]);
            }
            if (existing.rows.length > 0) {
                // Update existing venue with new information
                await database_1.default.query(`UPDATE venues SET
            rating = COALESCE($1, rating),
            phone = COALESCE($2, phone),
            website = COALESCE($3, website),
            hours = COALESCE($4, hours),
            features = COALESCE($5, features),
            image_url = COALESCE($6, image_url),
            updated_at = NOW()
          WHERE id = $7`, [
                    venue.rating,
                    venue.phone,
                    venue.website,
                    JSON.stringify(venue.hours),
                    venue.features,
                    venue.image_url,
                    existing.rows[0].id
                ]);
                console.log(`  ↻ Updated: ${venue.name}`);
                return false; // Not a new venue
            }
            // Insert new venue
            const id = (0, uuid_1.v4)();
            await database_1.default.query(`INSERT INTO venues (
          id, name, city_id, category, cuisine, price_range, description,
          address, phone, website, image_url, rating, coordinates, hours, features
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`, [
                id,
                venue.name,
                cityId,
                venue.category,
                venue.category, // Use category as cuisine for now
                venue.price_level ? '$'.repeat(venue.price_level) : '$$',
                venue.description,
                venue.address,
                venue.phone,
                venue.website,
                venue.image_url,
                venue.rating,
                JSON.stringify(venue.coordinates),
                JSON.stringify(venue.hours),
                venue.features || []
            ]);
            console.log(`  ✓ Added: ${venue.name} (${venue.source})`);
            return true;
        }
        catch (error) {
            console.error(`  ✗ Failed to save ${venue.name}:`, error);
            return false;
        }
    }
    /**
     * Run scraper for all cities
     */
    async scrapeAllCities() {
        console.log('🌍 Starting scraper for all cities...');
        const cities = await database_1.default.query('SELECT id, name FROM cities');
        let totalVenuesAdded = 0;
        for (const city of cities.rows) {
            console.log(`\n📍 Processing ${city.name}...`);
            const venuesAdded = await this.scrapeVenues(city.id);
            totalVenuesAdded += venuesAdded;
            // Add delay between cities to respect rate limits
            if (city !== cities.rows[cities.rows.length - 1]) {
                console.log('  ⏳ Waiting before next city...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        console.log(`\n✅ Completed scraping all cities. Total venues added: ${totalVenuesAdded}`);
    }
    /**
     * Schedule periodic scraping
     */
    startScheduledScraping(intervalHours = 24) {
        console.log(`⏰ Scheduling venue scraper to run every ${intervalHours} hours`);
        // Run immediately
        this.scrapeAllCities();
        // Schedule periodic runs
        setInterval(() => {
            this.scrapeAllCities();
        }, intervalHours * 60 * 60 * 1000);
    }
    /**
     * Get scraper status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            lastRunTime: this.lastRunTime,
            apiKeysConfigured: {
                google: !!this.googleApiKey,
                yelp: !!this.yelpApiKey,
                foursquare: !!this.foursquareApiKey
            }
        };
    }
}
exports.VenueScraperService = VenueScraperService;
//# sourceMappingURL=venue-scraper.service.js.map