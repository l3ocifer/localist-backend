import pool from '../config/database';

interface TrendingList {
  id: string;
  name: string;
  description: string;
  city_id: string;
  view_count: number;
  venue_count: number;
  created_at: Date;
  score: number;
}

export class TrendingService {
  private static instance: TrendingService;

  private constructor() {}

  static getInstance(): TrendingService {
    if (!TrendingService.instance) {
      TrendingService.instance = new TrendingService();
    }
    return TrendingService.instance;
  }

  /**
   * Get trending lists based on view count, saves, and recency
   */
  async getTrendingLists(cityId?: string, limit: number = 10): Promise<TrendingList[]> {
    try {
      let query = `
        WITH list_metrics AS (
          SELECT 
            ul.id,
            ul.name,
            ul.description,
            ul.city_id,
            ul.view_count,
            ul.created_at,
            array_length(ul.venue_ids, 1) as venue_count,
            COUNT(DISTINCT uf.user_id) as favorite_count,
            COUNT(DISTINCT lv.id) as view_count_recent
          FROM user_lists ul
          LEFT JOIN user_favorites uf ON uf.venue_id = ANY(ul.venue_ids)
          LEFT JOIN list_views lv ON lv.list_id = ul.id 
            AND lv.viewed_at > NOW() - INTERVAL '7 days'
          WHERE ul.is_public = true
      `;

      const params: any[] = [];
      let paramCount = 0;

      if (cityId) {
        paramCount++;
        query += ` AND ul.city_id = $${paramCount}`;
        params.push(cityId);
      }

      query += `
          GROUP BY ul.id, ul.name, ul.description, ul.city_id, ul.view_count, ul.created_at, ul.venue_ids
        ),
        scored_lists AS (
          SELECT 
            *,
            -- Trending score calculation:
            -- View count weight: 0.4
            -- Recent views (7 days) weight: 0.3
            -- Favorite count weight: 0.2
            -- Recency bonus weight: 0.1
            (
              (COALESCE(view_count, 0) * 0.4) +
              (COALESCE(view_count_recent, 0) * 0.3) +
              (COALESCE(favorite_count, 0) * 0.2) +
              (GREATEST(0, 100 - EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400) * 0.1)
            ) as score
          FROM list_metrics
          WHERE view_count > 0 OR favorite_count > 0
        )
        SELECT 
          id,
          name,
          description,
          city_id,
          view_count,
          venue_count,
          created_at,
          score
        FROM scored_lists
        ORDER BY score DESC
        LIMIT $${++paramCount}
      `;

      params.push(limit);

      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error getting trending lists:', error);
      return [];
    }
  }

  /**
   * Get trending venues based on interactions
   */
  async getTrendingVenues(cityId: string, limit: number = 10): Promise<any[]> {
    try {
      const query = `
        WITH venue_metrics AS (
          SELECT 
            v.id,
            v.name,
            v.city_id,
            COUNT(DISTINCT ui.user_id) as unique_users,
            COUNT(*) as total_interactions,
            COUNT(CASE WHEN ui.action = 'favorite' THEN 1 END) as favorite_count,
            COUNT(CASE WHEN ui.action = 'view' THEN 1 END) as view_count,
            COUNT(CASE WHEN ui.created_at > NOW() - INTERVAL '7 days' THEN 1 END) as recent_interactions
          FROM venues v
          LEFT JOIN user_interactions ui ON ui.venue_id = v.id
          WHERE v.city_id = $1
          GROUP BY v.id, v.name, v.city_id
        ),
        scored_venues AS (
          SELECT 
            *,
            (
              (COALESCE(unique_users, 0) * 0.3) +
              (COALESCE(total_interactions, 0) * 0.2) +
              (COALESCE(favorite_count, 0) * 0.3) +
              (COALESCE(recent_interactions, 0) * 0.2)
            ) as score
          FROM venue_metrics
          WHERE total_interactions > 0
        )
        SELECT 
          id,
          name,
          city_id,
          score
        FROM scored_venues
        ORDER BY score DESC
        LIMIT $2
      `;

      const result = await pool.query(query, [cityId, limit]);
      return result.rows;
    } catch (error) {
      console.error('Error getting trending venues:', error);
      return [];
    }
  }
}

