-- PostgreSQL schema for DiscoverLocal.ai
-- Task DB-001: Core Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20) UNIQUE,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  password_hash VARCHAR(255),
  preferences JSONB DEFAULT '{}',
  is_premium BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Cities table
CREATE TABLE IF NOT EXISTS cities (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  state VARCHAR(10),
  country VARCHAR(10) NOT NULL,
  description TEXT,
  image_url VARCHAR(500),
  timezone VARCHAR(50),
  coordinates JSONB NOT NULL
);

-- Venues table
CREATE TABLE IF NOT EXISTS venues (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  city_id VARCHAR(50) REFERENCES cities(id),
  category VARCHAR(100) NOT NULL,
  cuisine VARCHAR(100),
  price_range VARCHAR(10),
  description TEXT,
  address TEXT,
  phone VARCHAR(20),
  website VARCHAR(500),
  image_url VARCHAR(500),
  rating DECIMAL(2,1),
  coordinates JSONB NOT NULL,
  hours JSONB DEFAULT '{}',
  features TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Lists table
CREATE TABLE IF NOT EXISTS lists (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  city_id VARCHAR(50) REFERENCES cities(id),
  category VARCHAR(100),
  description TEXT,
  curator VARCHAR(200),
  is_featured BOOLEAN DEFAULT false,
  venue_ids TEXT[] DEFAULT '{}',
  image_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User lists table
CREATE TABLE IF NOT EXISTS user_lists (
  id VARCHAR(50) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  venue_ids TEXT[] DEFAULT '{}',
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
  id VARCHAR(50) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(500) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- User favorites table (additional)
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, venue_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_venues_city_id ON venues(city_id);
CREATE INDEX IF NOT EXISTS idx_venues_category ON venues(category);
CREATE INDEX IF NOT EXISTS idx_venues_cuisine ON venues(cuisine);
CREATE INDEX IF NOT EXISTS idx_lists_city_id ON lists(city_id);
CREATE INDEX IF NOT EXISTS idx_lists_featured ON lists(is_featured);
CREATE INDEX IF NOT EXISTS idx_user_lists_user_id ON user_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id ON user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_venue_id ON user_favorites(venue_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add update triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_venues_updated_at BEFORE UPDATE ON venues
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lists_updated_at BEFORE UPDATE ON lists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_lists_updated_at BEFORE UPDATE ON user_lists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();