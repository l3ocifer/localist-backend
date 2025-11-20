-- Add missing constraint for agents table
ALTER TABLE agents ADD CONSTRAINT agents_name_type_unique UNIQUE (name, type);

-- Insert sample data sources with authority weights
INSERT INTO data_sources (id, name, type, authority_weight, url, scrape_config, is_active) VALUES
  -- Expert Sources (High Authority)
  ('eater_38', 'Eater 38', 'expert_list', 0.90, 'https://www.eater.com', 
   '{"cities": ["nyc", "la", "chicago", "miami", "vegas"], "urlPattern": "https://www.eater.com/{city}/maps/"}', true),
  
  ('michelin', 'Michelin Guide', 'expert_list', 0.95, 'https://guide.michelin.com', 
   '{"regions": ["new-york", "california", "chicago"], "stars": [1, 2, 3]}', true),
  
  ('james_beard', 'James Beard Awards', 'expert_list', 0.85, 'https://www.jamesbeard.org', 
   '{"awards": ["best_new", "outstanding", "regional"]}', true),
  
  ('ny_times', 'New York Times', 'expert_list', 0.80, 'https://www.nytimes.com/reviews/dining', 
   '{"stars": [0, 1, 2, 3, 4]}', true),
  
  ('la_times', 'LA Times', 'expert_list', 0.75, 'https://www.latimes.com/food', 
   '{"sections": ["101-best", "gold-guide"]}', true),
  
  ('infatuation', 'The Infatuation', 'expert_list', 0.80, 'https://www.theinfatuation.com', 
   '{"cities": ["new-york", "los-angeles", "chicago", "miami", "san-francisco"], "urlPattern": "https://www.theinfatuation.com/{city}"}', true),
  
  ('thrillist', 'Thrillist', 'expert_list', 0.75, 'https://www.thrillist.com', 
   '{"cities": ["nyc", "la", "chicago", "miami", "sf"], "sections": ["food", "drink", "restaurants"]}', true),
  
  -- Consumer Review Sources (Medium Authority)
  ('yelp', 'Yelp', 'consumer_review', 0.30, 'https://api.yelp.com/v3', 
   '{"apiVersion": "v3", "rateLimit": "5000/day"}', true),
  
  ('google_places', 'Google Places', 'consumer_review', 0.35, 'https://maps.googleapis.com/maps/api', 
   '{"apiVersion": "v1", "fields": ["rating", "reviews", "photos"]}', true),
  
  ('tripadvisor', 'TripAdvisor', 'consumer_review', 0.25, 'https://api.tripadvisor.com', 
   '{"categories": ["restaurants", "nightlife", "attractions"]}', true),
  
  ('opentable', 'OpenTable', 'consumer_review', 0.40, 'https://www.opentable.com', 
   '{"bookingData": true, "ratings": true}', true),
  
  -- Social Sources (Lower Authority but High Signal)
  ('reddit', 'Reddit', 'social', 0.20, 'https://www.reddit.com/r/', 
   '{"subreddits": ["FoodNYC", "LosAngeles", "chicagofood", "Miami", "vegas"]}', true),
  
  ('instagram', 'Instagram', 'social', 0.15, 'https://www.instagram.com', 
   '{"hashtags": ["foodie", "restaurant", "dining"], "engagement": "likes,comments"}', true),
  
  ('twitter', 'Twitter (X)', 'social', 0.10, 'https://api.twitter.com', 
   '{"keywords": ["best restaurant", "food recommendation"], "influencers": []}', true),
  
  -- Search/Discovery Sources
  ('google_search', 'Google Search', 'search', 0.40, 'https://www.googleapis.com/customsearch', 
   '{"queries": ["best restaurants {city}", "top bars {city}"]}', true),
  
  -- Manual/Expert Curation
  ('manual_expert', 'Manual Expert Curation', 'manual', 1.00, null, 
   '{"reviewRequired": true, "expertValidation": true}', true)
ON CONFLICT (id) DO UPDATE SET
  authority_weight = EXCLUDED.authority_weight,
  scrape_config = EXCLUDED.scrape_config,
  is_active = EXCLUDED.is_active;

-- Insert sample curation algorithms
INSERT INTO curation_algorithms (id, name, version, expert_weight, consumer_weight, recency_weight, source_weights, min_source_count, min_confidence_score, boost_factors, is_active) VALUES
  ('default_v1', 'Default Curation Algorithm v1', '1.0', 0.70, 0.30, 0.20,
   '{"eater_38": 0.90, "michelin": 0.95, "james_beard": 0.85, "yelp": 0.30, "google_places": 0.35}',
   2, 0.70,
   '{"michelin_three_star": 20, "michelin_two_star": 15, "michelin_one_star": 10, "james_beard_winner": 10, "new_opening": 5, "instagram_hotspot": 3}',
   true),
  
  ('expert_heavy_v1', 'Expert-Heavy Algorithm v1', '1.0', 0.85, 0.15, 0.15,
   '{"eater_38": 0.90, "michelin": 0.95, "james_beard": 0.85, "ny_times": 0.80, "yelp": 0.20}',
   3, 0.80,
   '{"michelin_three_star": 25, "michelin_two_star": 18, "michelin_one_star": 12, "james_beard_winner": 15}',
   true),
  
  ('consumer_friendly_v1', 'Consumer-Friendly Algorithm v1', '1.0', 0.50, 0.50, 0.25,
   '{"eater_38": 0.75, "michelin": 0.85, "yelp": 0.40, "google_places": 0.45, "tripadvisor": 0.30}',
   2, 0.65,
   '{"michelin_star": 8, "high_rating": 5, "popular_neighborhood": 3, "affordable": 2}',
   true),
  
  ('trendy_v1', 'Trendy & New Algorithm v1', '1.0', 0.60, 0.40, 0.40,
   '{"eater_38": 0.85, "instagram": 0.30, "reddit": 0.25, "yelp": 0.35, "google_places": 0.35}',
   2, 0.60,
   '{"new_opening": 15, "instagram_hotspot": 10, "social_buzz": 8, "neighborhood_gem": 5}',
   true)
ON CONFLICT (id) DO UPDATE SET
  expert_weight = EXCLUDED.expert_weight,
  consumer_weight = EXCLUDED.consumer_weight,
  recency_weight = EXCLUDED.recency_weight,
  source_weights = EXCLUDED.source_weights,
  boost_factors = EXCLUDED.boost_factors,
  updated_at = NOW();

-- Create indexes for new tables
CREATE INDEX IF NOT EXISTS idx_data_sources_type ON data_sources(type, is_active);
CREATE INDEX IF NOT EXISTS idx_data_sources_active ON data_sources(is_active, last_scraped_at);

