-- ============================================================================
-- COMPLETE BUSINESS MODEL SCHEMA
-- All tables needed for monetization, tracking, and growth
-- ============================================================================

-- ============================================================================
-- 1. STRUCTURED TAXONOMIES (Cuisines, Vibes, Signature Dishes)
-- ============================================================================

-- Cuisine categories and sub-cuisines
CREATE TABLE IF NOT EXISTS cuisines (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  parent_id VARCHAR(50) REFERENCES cuisines(id), -- For sub-cuisines
  description TEXT,
  image_url TEXT,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cuisines_parent ON cuisines(parent_id);

-- Vibes/Occasions (Date Night, Walk-In Friendly, etc.)
CREATE TABLE IF NOT EXISTS vibes (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50), -- Icon name for UI
  display_order INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Signature Dishes (Burger, Pizza, Tacos, etc.)
CREATE TABLE IF NOT EXISTS signature_dishes (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  popularity_rank INT, -- 1 = most popular
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Meal Types (for auto-list generation)
CREATE TABLE IF NOT EXISTS meal_types (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL, -- Breakfast, Brunch, Lunch, Snacks, Drinks, Dinner, Late Night
  display_order INT DEFAULT 0
);

-- Insert default meal types
INSERT INTO meal_types (id, name, display_order) VALUES
  ('breakfast', 'Breakfast', 1),
  ('brunch', 'Brunch', 2),
  ('lunch', 'Lunch', 3),
  ('snacks', 'Snacks', 4),
  ('drinks', 'Drinks', 5),
  ('dinner', 'Dinner', 6),
  ('late_night', 'Late Night', 7)
ON CONFLICT (id) DO NOTHING;

-- Venue to taxonomy mappings
CREATE TABLE IF NOT EXISTS venue_cuisines (
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  cuisine_id VARCHAR(50) REFERENCES cuisines(id) ON DELETE CASCADE,
  PRIMARY KEY (venue_id, cuisine_id)
);

CREATE TABLE IF NOT EXISTS venue_vibes (
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  vibe_id VARCHAR(50) REFERENCES vibes(id) ON DELETE CASCADE,
  PRIMARY KEY (venue_id, vibe_id)
);

CREATE TABLE IF NOT EXISTS venue_signature_dishes (
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  dish_id VARCHAR(50) REFERENCES signature_dishes(id) ON DELETE CASCADE,
  is_famous_for BOOLEAN DEFAULT FALSE, -- Is this their signature?
  PRIMARY KEY (venue_id, dish_id)
);

CREATE TABLE IF NOT EXISTS venue_meal_types (
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  meal_type_id VARCHAR(50) REFERENCES meal_types(id) ON DELETE CASCADE,
  PRIMARY KEY (venue_id, meal_type_id)
);

-- ============================================================================
-- 2. USER PREFERENCES & SUBSCRIPTIONS (Monetization)
-- ============================================================================

-- User Subscription Tiers
CREATE TABLE IF NOT EXISTS subscription_tiers (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL, -- Free, Pro, Premium
  price_monthly DECIMAL(10,2),
  price_yearly DECIMAL(10,2),
  features JSONB, -- Feature flags
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default tiers
INSERT INTO subscription_tiers (id, name, price_monthly, price_yearly, features) VALUES
  ('free', 'Free', 0, 0, '{"custom_lists": true, "save_venues": true, "share_lists": true}'),
  ('pro', 'Pro', 25, 240, '{"custom_lists": true, "save_venues": true, "share_lists": true, "ai_concierge": true, "custom_itineraries": true, "advanced_recommendations": true}')
ON CONFLICT (id) DO NOTHING;

-- User Subscriptions
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
  tier_id VARCHAR(50) REFERENCES subscription_tiers(id),
  status VARCHAR(20) DEFAULT 'active', -- active, cancelled, expired, trial
  trial_ends_at TIMESTAMP WITH TIME ZONE,
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  stripe_subscription_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id);

-- User Preferences (Concierge Persona Builder)
CREATE TABLE IF NOT EXISTS user_preferences (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(50) UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  preferred_cities JSONB DEFAULT '[]', -- Array of city IDs
  preferred_cuisines JSONB DEFAULT '[]', -- Array of cuisine IDs
  dietary_restrictions JSONB DEFAULT '[]', -- vegetarian, vegan, gluten-free, etc.
  budget_preference VARCHAR(10), -- $, $$, $$$, $$$$
  dining_occasions JSONB DEFAULT '[]', -- date_night, quick_bite, fine_dining
  persona_tags JSONB DEFAULT '{}', -- Built from onboarding questions
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Onboarding Questions & Responses
CREATE TABLE IF NOT EXISTS onboarding_questions (
  id VARCHAR(50) PRIMARY KEY,
  category VARCHAR(100) NOT NULL, -- One of 30 categories
  question_text TEXT NOT NULL,
  question_type VARCHAR(20), -- single_choice, multi_choice, scale
  options JSONB, -- Answer options
  display_order INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_onboarding_responses (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
  question_id VARCHAR(50) REFERENCES onboarding_questions(id),
  response JSONB, -- User's answer
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, question_id)
);

-- ============================================================================
-- 3. REFERRAL & AFFILIATE TRACKING (Growth & Revenue)
-- ============================================================================

-- User Referrals (Invite Friends)
CREATE TABLE IF NOT EXISTS user_referrals (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  referrer_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
  referred_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
  referral_code VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, completed, rewarded
  reward_given BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_referrals_referrer ON user_referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_user_referrals_code ON user_referrals(referral_code);

-- Affiliate Partners (DraftKings, Live Nation, Liquor Brands)
CREATE TABLE IF NOT EXISTS affiliate_partners (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  partner_type VARCHAR(50), -- sports, events, brand, content_api
  contact_email VARCHAR(255),
  commission_type VARCHAR(20), -- per_click, per_install, per_sale, flat_fee
  commission_rate DECIMAL(10,2),
  contract_start DATE,
  contract_end DATE,
  api_key VARCHAR(255), -- For tracking
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Affiliate Link Clicks & Conversions
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  partner_id VARCHAR(50) REFERENCES affiliate_partners(id),
  user_id VARCHAR(50) REFERENCES users(id), -- Can be null for anonymous
  anonymous_id VARCHAR(100), -- For anonymous tracking
  source_type VARCHAR(50), -- list, venue, event
  source_id VARCHAR(50), -- ID of list/venue/event
  click_url TEXT,
  referrer_url TEXT,
  user_agent TEXT,
  ip_hash VARCHAR(64), -- Hashed for privacy
  clicked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_partner ON affiliate_clicks(partner_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_date ON affiliate_clicks(clicked_at);

CREATE TABLE IF NOT EXISTS affiliate_conversions (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  click_id VARCHAR(50) REFERENCES affiliate_clicks(id),
  partner_id VARCHAR(50) REFERENCES affiliate_partners(id),
  conversion_type VARCHAR(50), -- app_install, ticket_purchase, signup
  conversion_value DECIMAL(10,2),
  commission_earned DECIMAL(10,2),
  converted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Brand Partnerships (Liquor brands sponsoring lists)
CREATE TABLE IF NOT EXISTS brand_partnerships (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  partner_id VARCHAR(50) REFERENCES affiliate_partners(id),
  list_id VARCHAR(50) REFERENCES lists(id),
  sponsorship_type VARCHAR(50), -- featured, exclusive, co-branded
  monthly_fee DECIMAL(10,2),
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 4. SHARE TRACKING (Viral Growth & Analytics)
-- ============================================================================

CREATE TABLE IF NOT EXISTS share_events (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(50) REFERENCES users(id),
  anonymous_id VARCHAR(100),
  share_type VARCHAR(50) NOT NULL, -- list, venue, itinerary
  shared_entity_id VARCHAR(50) NOT NULL,
  share_method VARCHAR(50), -- link, facebook, twitter, email, sms
  share_code VARCHAR(50) UNIQUE, -- Tracking code in URL
  clicks INT DEFAULT 0,
  signups_from_share INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_share_events_user ON share_events(user_id);
CREATE INDEX IF NOT EXISTS idx_share_events_code ON share_events(share_code);

-- ============================================================================
-- 5. SEARCH QUERIES (Consumer Search Intelligence - CSI)
-- ============================================================================

CREATE TABLE IF NOT EXISTS search_queries (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(50) REFERENCES users(id),
  anonymous_id VARCHAR(100),
  query_text TEXT NOT NULL,
  city_id VARCHAR(50) REFERENCES cities(id),
  filters JSONB, -- cuisine, price, vibe filters applied
  results_count INT,
  clicked_result_id VARCHAR(50), -- Which result they clicked
  clicked_result_type VARCHAR(20), -- venue, list
  session_id VARCHAR(100),
  searched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_search_queries_city ON search_queries(city_id);
CREATE INDEX IF NOT EXISTS idx_search_queries_date ON search_queries(searched_at);

-- List Analytics
CREATE TABLE IF NOT EXISTS list_analytics (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  list_id VARCHAR(50) REFERENCES lists(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  views INT DEFAULT 0,
  unique_viewers INT DEFAULT 0,
  saves INT DEFAULT 0,
  shares INT DEFAULT 0,
  venue_clicks INT DEFAULT 0,
  avg_time_on_list INT, -- seconds
  UNIQUE(list_id, date)
);
CREATE INDEX IF NOT EXISTS idx_list_analytics_date ON list_analytics(date);

-- CSI Reports (Generated monthly reports for sale)
CREATE TABLE IF NOT EXISTS csi_reports (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  report_type VARCHAR(50), -- city, cuisine, trending, custom
  city_id VARCHAR(50) REFERENCES cities(id),
  period_start DATE,
  period_end DATE,
  report_data JSONB, -- The actual report content
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 6. INFLUENCER PROGRAM
-- ============================================================================

CREATE TABLE IF NOT EXISTS influencers (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(50) UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  bio TEXT,
  profile_image_url TEXT,
  social_links JSONB, -- instagram, tiktok, youtube, etc.
  city_id VARCHAR(50) REFERENCES cities(id), -- Primary city
  follower_count INT,
  verification_status VARCHAR(20) DEFAULT 'pending', -- pending, verified, rejected
  commission_rate DECIMAL(5,2) DEFAULT 10.00, -- Percentage
  total_earnings DECIMAL(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS influencer_applications (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(50) REFERENCES users(id),
  city_id VARCHAR(50) REFERENCES cities(id),
  social_handles JSONB,
  follower_count INT,
  why_apply TEXT,
  sample_content_urls JSONB,
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
  reviewed_by VARCHAR(50),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Influencer curated lists (marked as from influencer)
ALTER TABLE lists ADD COLUMN IF NOT EXISTS influencer_id VARCHAR(50) REFERENCES influencers(id);
ALTER TABLE lists ADD COLUMN IF NOT EXISTS is_influencer_list BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- 7. MERCHANT SYSTEM (Revenue)
-- ============================================================================

CREATE TABLE IF NOT EXISTS merchants (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(50) REFERENCES users(id), -- Owner account
  venue_id VARCHAR(50) REFERENCES venues(id), -- Their venue
  business_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  verification_status VARCHAR(20) DEFAULT 'pending',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_merchants_venue ON merchants(venue_id);

CREATE TABLE IF NOT EXISTS merchant_subscriptions (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  merchant_id VARCHAR(50) REFERENCES merchants(id) ON DELETE CASCADE,
  subscription_type VARCHAR(50), -- happy_hour, popup, premium_listing
  price DECIMAL(10,2),
  billing_cycle VARCHAR(20), -- monthly, yearly
  status VARCHAR(20) DEFAULT 'active',
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  stripe_subscription_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS merchant_payments (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  merchant_id VARCHAR(50) REFERENCES merchants(id),
  subscription_id VARCHAR(50) REFERENCES merchant_subscriptions(id),
  amount DECIMAL(10,2),
  payment_type VARCHAR(50), -- subscription, one_time, event
  stripe_payment_id VARCHAR(255),
  status VARCHAR(20), -- succeeded, failed, refunded
  paid_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 8. AUTO-LIST GENERATION (Star Feature)
-- ============================================================================

CREATE TABLE IF NOT EXISTS auto_list_requests (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(50) REFERENCES users(id),
  source_venue_id VARCHAR(50) REFERENCES venues(id), -- Venue they "starred"
  target_city_id VARCHAR(50) REFERENCES cities(id),
  meal_types JSONB, -- Selected meal types
  generated_list_id VARCHAR(50) REFERENCES lists(id), -- The created list
  status VARCHAR(20) DEFAULT 'pending', -- pending, generating, completed, failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 9. CONTENT API (White-label clients)
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_clients (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name VARCHAR(255) NOT NULL, -- e.g., VisitLasVegas.com
  api_key VARCHAR(255) UNIQUE NOT NULL,
  api_secret_hash VARCHAR(255),
  allowed_endpoints JSONB, -- Which endpoints they can access
  rate_limit INT DEFAULT 1000, -- Requests per hour
  monthly_fee DECIMAL(10,2),
  contact_email VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_usage_logs (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id VARCHAR(50) REFERENCES api_clients(id),
  endpoint VARCHAR(255),
  method VARCHAR(10),
  response_code INT,
  response_time_ms INT,
  request_ip VARCHAR(45),
  logged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_usage_client ON api_usage_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_date ON api_usage_logs(logged_at);

-- ============================================================================
-- 10. BIRTHDAY LOYALTY PROGRAM (Partner Integration)
-- ============================================================================

CREATE TABLE IF NOT EXISTS birthday_program_referrals (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(50) REFERENCES users(id),
  merchant_id VARCHAR(50) REFERENCES merchants(id),
  referral_type VARCHAR(20), -- consumer, merchant
  registration_completed BOOLEAN DEFAULT FALSE,
  commission_earned DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_venues_city_cuisine ON venues(city_id, cuisine);
CREATE INDEX IF NOT EXISTS idx_lists_city ON lists(city_id);
CREATE INDEX IF NOT EXISTS idx_lists_influencer ON lists(influencer_id) WHERE influencer_id IS NOT NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE cuisines IS 'Hierarchical cuisine taxonomy (e.g., Asian > Japanese > Ramen)';
COMMENT ON TABLE vibes IS 'Venue atmosphere/occasion tags (Date Night, Walk-In Friendly)';
COMMENT ON TABLE signature_dishes IS 'Popular dish types (Burger, Pizza, Tacos)';
COMMENT ON TABLE user_subscriptions IS 'User paid subscription tracking (Pro tier)';
COMMENT ON TABLE user_preferences IS 'Concierge persona built from onboarding';
COMMENT ON TABLE affiliate_partners IS 'Revenue partners (DraftKings, Live Nation, liquor brands)';
COMMENT ON TABLE share_events IS 'Tracks list/venue shares for viral growth';
COMMENT ON TABLE search_queries IS 'Consumer Search Intelligence data for reports';
COMMENT ON TABLE csi_reports IS 'Generated monthly CSI reports for sale';
COMMENT ON TABLE influencers IS 'Verified influencer profiles';
COMMENT ON TABLE merchants IS 'Business accounts for venue owners';
COMMENT ON TABLE api_clients IS 'White-label API customers (e.g., VisitLasVegas)';

