-- MVP Schema Updates
-- Based on Localist MVP Tasks by Role

-- Module 1.3: Featured Lists
ALTER TABLE lists ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false;

-- Module 1.5: Sample Itineraries
CREATE TABLE IF NOT EXISTS itineraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id VARCHAR(50) REFERENCES cities(id),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  duration_days INTEGER,
  vibe VARCHAR(100),
  is_preset BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS itinerary_venues (
  itinerary_id UUID REFERENCES itineraries(id) ON DELETE CASCADE,
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  day_number INTEGER,
  order_index INTEGER,
  PRIMARY KEY (itinerary_id, venue_id)
);

-- Module 2.1: Password Reset
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Module 2.4: Preferences & Onboarding
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

-- Module 3.2: List Sharing
ALTER TABLE user_lists ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;
ALTER TABLE user_lists ADD COLUMN IF NOT EXISTS share_token VARCHAR(255) UNIQUE;

-- Module 3.3: List Discovery
ALTER TABLE user_lists ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;
CREATE TABLE IF NOT EXISTS list_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES user_lists(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES users(id), -- Nullable for anonymous views
  viewed_at TIMESTAMP DEFAULT NOW()
);

-- Module 5.1: Merchant Submissions
CREATE TABLE IF NOT EXISTS merchant_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_email VARCHAR(255) NOT NULL,
  venue_id VARCHAR(50) REFERENCES venues(id),
  submission_type VARCHAR(50), -- 'happy_hour' or 'pop_up'
  title VARCHAR(200),
  description TEXT,
  image_url VARCHAR(500),
  start_date DATE,
  end_date DATE,
  hours JSONB,
  menu_url VARCHAR(500),
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  payment_status VARCHAR(50),
  stripe_payment_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS happy_hour_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id VARCHAR(50) REFERENCES venues(id),
  submission_id UUID REFERENCES merchant_submissions(id),
  title VARCHAR(200),
  description TEXT,
  days_of_week INTEGER[], -- [1,2,3,4,5] for Mon-Fri
  start_time TIME,
  end_time TIME,
  image_url VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Module 5.2: Pop-Up Events
CREATE TABLE IF NOT EXISTS pop_up_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id VARCHAR(50) REFERENCES venues(id),
  submission_id UUID REFERENCES merchant_submissions(id),
  title VARCHAR(200),
  description TEXT,
  event_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  image_url VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Module 6.1: Admin Dashboard
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';

-- Module 6.2: Content Ingestion System
CREATE TABLE IF NOT EXISTS scraping_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(50) NOT NULL, -- 'google', 'yelp', 'eater', etc.
  city_id VARCHAR(50) REFERENCES cities(id),
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
  items_found INTEGER DEFAULT 0,
  items_processed INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(255) NOT NULL,
  source VARCHAR(50) DEFAULT 'csv',
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  total_rows INTEGER DEFAULT 0,
  processed_rows INTEGER DEFAULT 0,
  failed_rows INTEGER DEFAULT 0,
  error_log JSONB,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL, -- 'venue', 'list', 'event'
  entity_id VARCHAR(255), -- ID of the item (could be UUID or string depending on table)
  source VARCHAR(50),
  change_type VARCHAR(50), -- 'new', 'update', 'delete'
  data_snapshot JSONB, -- The data to review
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Module 7.1: DDD Integration
ALTER TABLE venues ADD COLUMN IF NOT EXISTS is_ddd_featured BOOLEAN DEFAULT false;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS ddd_episode_url VARCHAR(500);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS ddd_episode_title VARCHAR(200);

