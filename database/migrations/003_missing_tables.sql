-- Missing tables for comprehensive seed data support

-- Saved venues table (user favorites)
CREATE TABLE IF NOT EXISTS saved_venues (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, venue_id)
);

-- List venues relationship table
CREATE TABLE IF NOT EXISTS list_venues (
  list_id VARCHAR(50) REFERENCES lists(id) ON DELETE CASCADE,
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  notes TEXT,
  added_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (list_id, venue_id)
);

-- Add missing columns to users table if they don't exist
ALTER TABLE users
ADD COLUMN IF NOT EXISTS username VARCHAR(100) UNIQUE,
ADD COLUMN IF NOT EXISTS full_name VARCHAR(200),
ADD COLUMN IF NOT EXISTS bio TEXT,
ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500),
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;

-- Add missing columns to lists table if they don't exist
ALTER TABLE lists
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;

-- Fix user_lists table to match new structure
ALTER TABLE user_lists
DROP CONSTRAINT IF EXISTS user_lists_pkey CASCADE;

ALTER TABLE user_lists
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

-- Create new constraint for user_lists
ALTER TABLE user_lists
ADD CONSTRAINT user_lists_pkey PRIMARY KEY (user_id, list_id);

-- Venue analytics table for tracking performance
CREATE TABLE IF NOT EXISTS venue_analytics (
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  views INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  PRIMARY KEY (venue_id, date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_saved_venues_user_id ON saved_venues(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_venues_venue_id ON saved_venues(venue_id);
CREATE INDEX IF NOT EXISTS idx_list_venues_list_id ON list_venues(list_id);
CREATE INDEX IF NOT EXISTS idx_list_venues_venue_id ON list_venues(venue_id);
CREATE INDEX IF NOT EXISTS idx_lists_user_id ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_venue_analytics_date ON venue_analytics(date DESC);