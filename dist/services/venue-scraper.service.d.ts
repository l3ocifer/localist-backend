export declare class VenueScraperService {
    private static instance;
    private isRunning;
    private lastRunTime;
    private googleApiKey;
    private yelpApiKey;
    private foursquareApiKey;
    private constructor();
    static getInstance(): VenueScraperService;
    /**
     * Main scraper method - runs periodically to fetch new venues
     */
    scrapeVenues(cityId: string, category?: string): Promise<number>;
    /**
     * Google Places API scraper
     */
    private scrapeGooglePlaces;
    /**
     * Transform Google Place to our venue format
     */
    private transformGooglePlace;
    /**
     * Parse Google's weekday_text format into our hours format
     */
    private parseGoogleHours;
    /**
     * Convert 12-hour time to 24-hour format
     */
    private convertTo24Hour;
    /**
     * Yelp Fusion API scraper
     */
    private scrapeYelp;
    /**
     * Transform Yelp business to our venue format
     */
    private transformYelpBusiness;
    /**
     * Parse Yelp hours format
     */
    private parseYelpHours;
    /**
     * Format Yelp time (HHMM) to HH:MM
     */
    private formatYelpTime;
    /**
     * Foursquare API scraper
     */
    private scrapeFoursquare;
    /**
     * Transform Foursquare venue to our format
     */
    private transformFoursquareVenue;
    /**
     * Parse Foursquare hours format
     */
    private parseFoursquareHours;
    /**
     * Format Foursquare time (HHMM) to HH:MM
     */
    private formatFoursquareTime;
    /**
     * Normalize Foursquare category names
     */
    private normalizeFoursquareCategory;
    /**
     * Extract features from Google Places types
     */
    private extractFeaturesFromTypes;
    /**
     * Normalize category names across different sources
     */
    private normalizeCategory;
    /**
     * Deduplicate venues based on name and location similarity
     */
    private deduplicateVenues;
    /**
     * Create a normalized key for venue comparison
     */
    private createVenueKey;
    /**
     * Check if two venues are similar (likely duplicates)
     */
    private areSimilarVenues;
    /**
     * Check if two venues are the same (exact match from different sources)
     */
    private areSameVenue;
    /**
     * Merge data from multiple sources for the same venue
     */
    private mergeVenueData;
    /**
     * Calculate string similarity (Levenshtein distance based)
     */
    private calculateSimilarity;
    /**
     * Calculate Levenshtein distance between two strings
     */
    private levenshteinDistance;
    /**
     * Calculate distance between two coordinates in kilometers
     */
    private calculateDistance;
    /**
     * Convert degrees to radians
     */
    private toRad;
    /**
     * Save venue to database if it doesn't exist
     */
    private saveVenue;
    /**
     * Run scraper for all cities
     */
    scrapeAllCities(): Promise<void>;
    /**
     * Schedule periodic scraping
     */
    startScheduledScraping(intervalHours?: number): void;
    /**
     * Get scraper status
     */
    getStatus(): {
        isRunning: boolean;
        lastRunTime: Date | null;
        apiKeysConfigured: {
            google: boolean;
            yelp: boolean;
            foursquare: boolean;
        };
    };
}
//# sourceMappingURL=venue-scraper.service.d.ts.map