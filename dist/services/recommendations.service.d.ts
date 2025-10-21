import { Venue } from '../types';
interface UserProfile {
    userId: string;
    preferences: {
        cuisines: string[];
        priceRange: string[];
        categories: string[];
        dietaryRestrictions?: string[];
    };
    interactions: {
        venueId: string;
        action: 'view' | 'save' | 'share' | 'visit' | 'favorite';
        timestamp: Date;
        duration?: number;
        rating?: number;
    }[];
}
export declare class RecommendationService {
    private static instance;
    private constructor();
    static getInstance(): RecommendationService;
    /**
     * Get personalized recommendations for a user
     */
    getPersonalizedRecommendations(userId: string, cityId: string, limit?: number): Promise<Venue[]>;
    /**
     * Get collaborative filtering recommendations based on similar users
     */
    getCollaborativeRecommendations(userId: string, cityId: string, limit?: number): Promise<Venue[]>;
    /**
     * Get content-based recommendations based on venue features
     */
    getContentBasedRecommendations(userId: string, cityId: string, limit?: number): Promise<Venue[]>;
    /**
     * Get hybrid recommendations combining multiple algorithms
     */
    getHybridRecommendations(userId: string, cityId: string, limit?: number): Promise<{
        recommendations: Venue[];
        methodology: string[];
    }>;
    /**
     * Get trending venues based on recent activity
     */
    getTrendingVenues(cityId: string, limit?: number): Promise<Venue[]>;
    /**
     * Get recommendations for new users (cold start problem)
     */
    getColdStartRecommendations(cityId: string, preferences?: Partial<UserProfile['preferences']>, limit?: number): Promise<Venue[]>;
    /**
     * Track user interaction for improving recommendations
     */
    trackInteraction(userId: string, venueId: string, action: UserProfile['interactions'][0]['action'], metadata?: {
        duration?: number;
        rating?: number;
        context?: string;
    }): Promise<void>;
    /**
     * Get user profile for recommendation scoring
     */
    private getUserProfile;
    /**
     * Get candidate venues for recommendation
     */
    private getCandidateVenues;
    /**
     * Score venues based on user profile
     */
    private scoreVenues;
    /**
     * Select top venues from scored list
     */
    private selectTopVenues;
    /**
     * Enrich venue data with additional information
     */
    private enrichVenueData;
    /**
     * Get fallback recommendations when personalization fails
     */
    private getFallbackRecommendations;
}
export {};
//# sourceMappingURL=recommendations.service.d.ts.map