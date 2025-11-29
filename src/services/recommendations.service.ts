import pool from '../config/database';
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

// interface VenueFeatures {
// Commented out - may be used in future implementations
/*
  categoryScore: number;
  cuisineScore: number;
  priceScore: number;
  ratingScore: number;
  popularityScore: number;
  distanceScore?: number;
}
*/

interface RecommendationScore {
  venueId: string;
  score: number;
  reasons: string[];
  confidence: number;
}

export class RecommendationService {
  private static instance: RecommendationService;

  private constructor() {}

  static getInstance(): RecommendationService {
    if (!RecommendationService.instance) {
      RecommendationService.instance = new RecommendationService();
    }
    return RecommendationService.instance;
  }

  /**
   * Get personalized recommendations for a user
   */
  async getPersonalizedRecommendations(
    userId: string,
    cityId: string,
    limit: number = 10
  ): Promise<Venue[]> {
    try {
      const userProfile = await this.getUserProfile(userId);
      const candidateVenues = await this.getCandidateVenues(cityId, userId);
      const scoredVenues = await this.scoreVenues(candidateVenues, userProfile);
      const topVenues = this.selectTopVenues(scoredVenues, limit);

      return this.enrichVenueData(topVenues);
    } catch (error) {
      console.error('Error getting personalized recommendations:', error);
      return this.getFallbackRecommendations(cityId, limit);
    }
  }

  /**
   * Get collaborative filtering recommendations based on similar users
   */
  async getCollaborativeRecommendations(
    userId: string,
    cityId: string,
    limit: number = 10
  ): Promise<Venue[]> {
    const query = `
      WITH user_similarity AS (
        SELECT
          uf2.user_id as similar_user,
          COUNT(DISTINCT uf2.venue_id) as common_venues,
          COUNT(DISTINCT uf2.venue_id)::float /
            (SELECT COUNT(*) FROM user_favorites WHERE user_id = $1)::float as similarity
        FROM user_favorites uf1
        JOIN user_favorites uf2 ON uf1.venue_id = uf2.venue_id
        WHERE uf1.user_id = $1 AND uf2.user_id != $1
        GROUP BY uf2.user_id
        HAVING COUNT(DISTINCT uf2.venue_id) > 2
        ORDER BY similarity DESC
        LIMIT 20
      ),
      recommended_venues AS (
        SELECT
          v.*,
          COUNT(DISTINCT us.similar_user) as recommender_count,
          AVG(us.similarity) as avg_similarity
        FROM user_similarity us
        JOIN user_favorites uf ON us.similar_user = uf.user_id
        JOIN venues v ON uf.venue_id = v.id
        WHERE v.city_id = $2
        AND v.id NOT IN (
          SELECT venue_id FROM user_favorites WHERE user_id = $1
        )
        GROUP BY v.id, v.name, v.city_id, v.category, v.cuisine, v.price_range,
                 v.description, v.address, v.phone, v.website, v.image_url,
                 v.rating, v.coordinates, v.hours, v.features, v.created_at, v.updated_at
        ORDER BY recommender_count DESC, avg_similarity DESC, v.rating DESC
        LIMIT $3
      )
      SELECT * FROM recommended_venues;
    `;

    const result = await pool.query(query, [userId, cityId, limit]);
    return result.rows;
  }

  /**
   * Get content-based recommendations based on venue features
   */
  async getContentBasedRecommendations(
    userId: string,
    cityId: string,
    limit: number = 10
  ): Promise<Venue[]> {
    // const userPreferences = await this.getUserPreferences(userId);
    // TODO: Use userPreferences in recommendation algorithm

    const query = `
      WITH user_venue_features AS (
        SELECT
          category,
          cuisine,
          price_range,
          COUNT(*) as interaction_count
        FROM venues v
        JOIN user_favorites uf ON v.id = uf.venue_id
        WHERE uf.user_id = $1
        GROUP BY category, cuisine, price_range
      ),
      scored_venues AS (
        SELECT
          v.*,
          (
            CASE WHEN v.category IN (SELECT category FROM user_venue_features)
              THEN 0.3 ELSE 0 END +
            CASE WHEN v.cuisine IN (SELECT cuisine FROM user_venue_features)
              THEN 0.3 ELSE 0 END +
            CASE WHEN v.price_range IN (SELECT price_range FROM user_venue_features)
              THEN 0.2 ELSE 0 END +
            CASE WHEN v.rating >= 4.0 THEN 0.2 ELSE 0 END
          ) as match_score
        FROM venues v
        WHERE v.city_id = $2
        AND v.id NOT IN (
          SELECT venue_id FROM user_favorites WHERE user_id = $1
        )
      )
      SELECT * FROM scored_venues
      WHERE match_score > 0
      ORDER BY match_score DESC, rating DESC
      LIMIT $3;
    `;

    const result = await pool.query(query, [userId, cityId, limit]);
    return result.rows;
  }

  /**
   * Get hybrid recommendations combining multiple algorithms
   */
  async getHybridRecommendations(
    userId: string,
    cityId: string,
    limit: number = 10
  ): Promise<{
    recommendations: Venue[];
    methodology: string[];
  }> {
    const [collaborative, contentBased, trending] = await Promise.all([
      this.getCollaborativeRecommendations(userId, cityId, Math.ceil(limit * 0.4)),
      this.getContentBasedRecommendations(userId, cityId, Math.ceil(limit * 0.4)),
      this.getTrendingVenues(cityId, Math.ceil(limit * 0.2)),
    ]);

    const venueMap = new Map<string, { venue: Venue; score: number; sources: string[] }>();

    collaborative.forEach((venue) => {
      venueMap.set(venue.id, {
        venue,
        score: 0.4,
        sources: ['collaborative'],
      });
    });

    contentBased.forEach((venue) => {
      if (venueMap.has(venue.id)) {
        const existing = venueMap.get(venue.id)!;
        existing.score += 0.4;
        existing.sources.push('content');
      } else {
        venueMap.set(venue.id, {
          venue,
          score: 0.35,
          sources: ['content'],
        });
      }
    });

    trending.forEach((venue) => {
      if (venueMap.has(venue.id)) {
        const existing = venueMap.get(venue.id)!;
        existing.score += 0.2;
        existing.sources.push('trending');
      } else {
        venueMap.set(venue.id, {
          venue,
          score: 0.15,
          sources: ['trending'],
        });
      }
    });

    const sortedRecommendations = Array.from(venueMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      recommendations: sortedRecommendations.map((r) => r.venue),
      methodology: [...new Set(sortedRecommendations.flatMap((r) => r.sources))],
    };
  }

  /**
   * Get trending venues based on recent activity
   * If cityId is not provided, returns trending venues across all cities
   */
  async getTrendingVenues(cityId?: string, limit: number = 10): Promise<Venue[]> {
    // First try to get venues with recent activity
    let query: string;
    let params: any[];

    if (cityId) {
      query = `
        WITH recent_activity AS (
          SELECT
            venue_id,
            COUNT(*) as activity_count,
            COUNT(DISTINCT user_id) as unique_users
          FROM user_favorites
          WHERE created_at > NOW() - INTERVAL '7 days'
          GROUP BY venue_id
        )
        SELECT v.*
        FROM venues v
        LEFT JOIN recent_activity ra ON v.id = ra.venue_id
        WHERE v.city_id = $1
        ORDER BY COALESCE(ra.activity_count, 0) DESC, v.rating DESC NULLS LAST
        LIMIT $2;
      `;
      params = [cityId, limit];
    } else {
      // Global trending - across all cities
      query = `
        WITH recent_activity AS (
          SELECT
            venue_id,
            COUNT(*) as activity_count,
            COUNT(DISTINCT user_id) as unique_users
          FROM user_favorites
          WHERE created_at > NOW() - INTERVAL '7 days'
          GROUP BY venue_id
        )
        SELECT v.*
        FROM venues v
        LEFT JOIN recent_activity ra ON v.id = ra.venue_id
        ORDER BY COALESCE(ra.activity_count, 0) DESC, v.rating DESC NULLS LAST
        LIMIT $1;
      `;
      params = [limit];
    }

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get recommendations for new users (cold start problem)
   */
  async getColdStartRecommendations(
    cityId: string,
    preferences?: Partial<UserProfile['preferences']>,
    limit: number = 10
  ): Promise<Venue[]> {
    let query = `
      SELECT v.*
      FROM venues v
      WHERE v.city_id = $1
      AND v.rating >= 4.0
    `;

    const params: any[] = [cityId];
    let paramCount = 1;

    if (preferences?.categories && preferences.categories.length > 0) {
      paramCount++;
      query += ` AND v.category = ANY($${paramCount}::text[])`;
      params.push(preferences.categories);
    }

    if (preferences?.cuisines && preferences.cuisines.length > 0) {
      paramCount++;
      query += ` AND v.cuisine = ANY($${paramCount}::text[])`;
      params.push(preferences.cuisines);
    }

    if (preferences?.priceRange && preferences.priceRange.length > 0) {
      paramCount++;
      query += ` AND v.price_range = ANY($${paramCount}::text[])`;
      params.push(preferences.priceRange);
    }

    query += ` ORDER BY v.rating DESC, v.name LIMIT $${++paramCount}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Track user interaction for improving recommendations
   */
  async trackInteraction(
    userId: string,
    venueId: string,
    action: UserProfile['interactions'][0]['action'],
    metadata?: {
      duration?: number;
      rating?: number;
      context?: string;
      source?: string;
      timeOfDay?: string;
      dayOfWeek?: number;
      ipAddress?: string;
      userAgent?: string;
      referrer?: string;
      listId?: string;
      cityId?: string;
      sessionId?: string;
      deviceType?: string;
    }
  ): Promise<void> {
    const now = new Date();
    const timeOfDay = metadata?.timeOfDay || this.getTimeOfDay(now);
    const dayOfWeek = metadata?.dayOfWeek !== undefined ? metadata.dayOfWeek : now.getDay();

    const query = `
      INSERT INTO user_interactions (
        user_id, venue_id, action, duration, rating, context,
        source, time_of_day, day_of_week, ip_address, user_agent,
        referrer, list_id, city_id, session_id, device_type, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
    `;

    await pool.query(query, [
      userId,
      venueId,
      action,
      metadata?.duration || null,
      metadata?.rating || null,
      metadata?.context || null,
      metadata?.source || null,
      timeOfDay,
      dayOfWeek,
      metadata?.ipAddress || null,
      metadata?.userAgent || null,
      metadata?.referrer || null,
      metadata?.listId || null,
      metadata?.cityId || null,
      metadata?.sessionId || null,
      metadata?.deviceType || null,
    ]);
  }

  /**
   * Get time of day category from Date object
   */
  private getTimeOfDay(date: Date): string {
    const hour = date.getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  /**
   * Get user profile for recommendation scoring
   */
  private async getUserProfile(userId: string): Promise<UserProfile> {
    const [userResult, interactionsResult] = await Promise.all([
      pool.query('SELECT preferences FROM users WHERE id = $1', [userId]),
      pool.query(
        `
        SELECT venue_id, 'favorite' as action, created_at as timestamp
        FROM user_favorites
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 100
      `,
        [userId]
      ),
    ]);

    const preferences = userResult.rows[0]?.preferences || {};
    const interactions = interactionsResult.rows.map((row) => ({
      venueId: row.venue_id,
      action: row.action as UserProfile['interactions'][0]['action'],
      timestamp: row.timestamp,
    }));

    return {
      userId,
      preferences: {
        cuisines: preferences.cuisines || [],
        priceRange: preferences.price_range || [],
        categories: preferences.categories || [],
        dietaryRestrictions: preferences.dietary || [],
      },
      interactions,
    };
  }

  /**
   * Get candidate venues for recommendation
   */
  private async getCandidateVenues(cityId: string, userId: string): Promise<Venue[]> {
    const query = `
      SELECT v.*
      FROM venues v
      WHERE v.city_id = $1
      AND v.id NOT IN (
        SELECT venue_id FROM user_favorites WHERE user_id = $2
      )
      ORDER BY v.rating DESC
      LIMIT 100;
    `;

    const result = await pool.query(query, [cityId, userId]);
    return result.rows;
  }

  /**
   * Score venues based on user profile
   */
  private async scoreVenues(
    venues: Venue[],
    userProfile: UserProfile
  ): Promise<RecommendationScore[]> {
    return venues.map((venue) => {
      let score = 0;
      const reasons: string[] = [];
      let confidence = 0.5;

      if (userProfile.preferences.categories.includes(venue.category)) {
        score += 0.3;
        reasons.push(`Matches your preferred category: ${venue.category}`);
        confidence += 0.1;
      }

      if (venue.cuisine && userProfile.preferences.cuisines.includes(venue.cuisine)) {
        score += 0.3;
        reasons.push(`Matches your favorite cuisine: ${venue.cuisine}`);
        confidence += 0.1;
      }

      if (venue.price_range && userProfile.preferences.priceRange.includes(venue.price_range)) {
        score += 0.2;
        reasons.push('In your price range');
        confidence += 0.05;
      }

      if (venue.rating && venue.rating >= 4.5) {
        score += 0.15;
        reasons.push('Highly rated');
      }

      const recentInteractions = userProfile.interactions.filter((i) => {
        const daysSince = (Date.now() - new Date(i.timestamp).getTime()) / (1000 * 60 * 60 * 24);
        return daysSince <= 30;
      });

      if (recentInteractions.length > 0) {
        confidence = Math.min(0.9, confidence + recentInteractions.length * 0.02);
      }

      return {
        venueId: venue.id,
        score,
        reasons,
        confidence,
      };
    });
  }

  /**
   * Select top venues from scored list
   */
  private selectTopVenues(
    scoredVenues: RecommendationScore[],
    limit: number
  ): RecommendationScore[] {
    return scoredVenues
      .filter((v) => v.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Enrich venue data with additional information
   */
  private async enrichVenueData(scoredVenues: RecommendationScore[]): Promise<Venue[]> {
    if (scoredVenues.length === 0) return [];

    const venueIds = scoredVenues.map((v) => v.venueId);
    const query = `
      SELECT v.*, c.name as city_name
      FROM venues v
      LEFT JOIN cities c ON v.city_id = c.id
      WHERE v.id = ANY($1::text[])
    `;

    const result = await pool.query(query, [venueIds]);

    const venueMap = new Map(result.rows.map((v) => [v.id, v]));
    return scoredVenues.map((sv) => venueMap.get(sv.venueId)).filter((v) => v !== undefined);
  }

  /**
   * Get fallback recommendations when personalization fails
   */
  private async getFallbackRecommendations(cityId: string, limit: number): Promise<Venue[]> {
    const query = `
      SELECT v.*
      FROM venues v
      WHERE v.city_id = $1
      AND v.rating >= 4.0
      ORDER BY v.rating DESC, v.name
      LIMIT $2;
    `;

    const result = await pool.query(query, [cityId, limit]);
    return result.rows;
  }

  /**
   * Get user preferences
   * TODO: Implement when user preferences are utilized
   */
  /*
  private async _getUserPreferences(userId: string): Promise<any> {
    const result = await pool.query(
      'SELECT preferences FROM users WHERE id = $1',
      [userId]
    );
    return result.rows[0]?.preferences || {};
  }
  */
}
