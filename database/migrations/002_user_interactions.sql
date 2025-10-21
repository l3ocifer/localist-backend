-- User interactions table for recommendation engine
-- Task AI-001: Recommendation Engine Support

CREATE TABLE IF NOT EXISTS user_interactions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL CHECK (action IN ('view', 'save', 'share', 'visit', 'favorite')),
  duration INTEGER, -- Duration in seconds for view actions
  rating DECIMAL(2,1) CHECK (rating >= 1 AND rating <= 5),
  context VARCHAR(100), -- Context like 'search', 'recommendation', 'list'
  device_type VARCHAR(20), -- 'mobile', 'desktop', 'tablet'
  session_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_interactions_user_id ON user_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_interactions_venue_id ON user_interactions(venue_id);
CREATE INDEX IF NOT EXISTS idx_interactions_action ON user_interactions(action);
CREATE INDEX IF NOT EXISTS idx_interactions_created_at ON user_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_user_venue ON user_interactions(user_id, venue_id);

-- Analytics views for recommendation engine
CREATE OR REPLACE VIEW venue_popularity AS
SELECT 
  venue_id,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) as total_interactions,
  AVG(CASE WHEN rating IS NOT NULL THEN rating END) as avg_rating,
  COUNT(CASE WHEN action = 'favorite' THEN 1 END) as favorite_count,
  COUNT(CASE WHEN action = 'share' THEN 1 END) as share_count,
  COUNT(CASE WHEN action = 'visit' THEN 1 END) as visit_count
FROM user_interactions
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY venue_id;

CREATE OR REPLACE VIEW user_engagement AS
SELECT 
  user_id,
  COUNT(DISTINCT venue_id) as venues_interacted,
  COUNT(*) as total_interactions,
  COUNT(DISTINCT DATE(created_at)) as active_days,
  AVG(CASE WHEN duration IS NOT NULL THEN duration END) as avg_view_duration,
  COUNT(CASE WHEN action = 'favorite' THEN 1 END) as favorites_count
FROM user_interactions
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY user_id;