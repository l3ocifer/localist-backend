-- Enhance user_interactions table with additional context fields
ALTER TABLE user_interactions
ADD COLUMN IF NOT EXISTS source VARCHAR(100), -- 'search', 'recommendation', 'list', 'city_view', 'direct'
ADD COLUMN IF NOT EXISTS time_of_day VARCHAR(20), -- 'morning', 'afternoon', 'evening', 'night'
ADD COLUMN IF NOT EXISTS day_of_week INTEGER, -- 0-6 (Sunday-Saturday)
ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
ADD COLUMN IF NOT EXISTS user_agent TEXT,
ADD COLUMN IF NOT EXISTS referrer VARCHAR(500),
ADD COLUMN IF NOT EXISTS list_id VARCHAR(50), -- If interaction came from a list
ADD COLUMN IF NOT EXISTS city_id VARCHAR(50); -- City context

-- Create index for analytics queries
CREATE INDEX IF NOT EXISTS idx_interactions_source ON user_interactions(source);
CREATE INDEX IF NOT EXISTS idx_interactions_time_of_day ON user_interactions(time_of_day);
CREATE INDEX IF NOT EXISTS idx_interactions_list_id ON user_interactions(list_id);
CREATE INDEX IF NOT EXISTS idx_interactions_city_id ON user_interactions(city_id);
CREATE INDEX IF NOT EXISTS idx_interactions_created_at_hour ON user_interactions(DATE_TRUNC('hour', created_at));

-- Create view for venue analytics
CREATE OR REPLACE VIEW venue_analytics_detailed AS
SELECT 
  venue_id,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) as total_interactions,
  COUNT(CASE WHEN action = 'view' THEN 1 END) as view_count,
  COUNT(CASE WHEN action = 'save' THEN 1 END) as save_count,
  COUNT(CASE WHEN action = 'favorite' THEN 1 END) as favorite_count,
  COUNT(CASE WHEN action = 'share' THEN 1 END) as share_count,
  COUNT(CASE WHEN action = 'visit' THEN 1 END) as visit_count,
  AVG(CASE WHEN rating IS NOT NULL THEN rating END) as avg_rating,
  AVG(CASE WHEN duration IS NOT NULL THEN duration END) as avg_view_duration,
  COUNT(DISTINCT source) as source_count,
  COUNT(DISTINCT city_id) as city_count
FROM user_interactions
WHERE created_at > NOW() - INTERVAL '90 days'
GROUP BY venue_id;

-- Create view for user behavior patterns
CREATE OR REPLACE VIEW user_behavior_patterns AS
SELECT 
  user_id,
  COUNT(DISTINCT venue_id) as venues_interacted,
  COUNT(*) as total_interactions,
  COUNT(DISTINCT DATE(created_at)) as active_days,
  COUNT(DISTINCT city_id) as cities_explored,
  AVG(CASE WHEN duration IS NOT NULL THEN duration END) as avg_view_duration,
  COUNT(CASE WHEN action = 'favorite' THEN 1 END) as favorites_count,
  COUNT(CASE WHEN action = 'save' THEN 1 END) as saves_count,
  COUNT(CASE WHEN action = 'share' THEN 1 END) as shares_count,
  MODE() WITHIN GROUP (ORDER BY time_of_day) as preferred_time_of_day,
  MODE() WITHIN GROUP (ORDER BY day_of_week) as preferred_day_of_week
FROM user_interactions
WHERE created_at > NOW() - INTERVAL '90 days'
GROUP BY user_id;

