-- PostgreSQL schema for Localist
-- Migration 001: Core Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20) UNIQUE,
  username VARCHAR(100) UNIQUE,
  full_name VARCHAR(200),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  bio TEXT,
  avatar_url VARCHAR(500),
  password_hash VARCHAR(255),
  preferences JSONB DEFAULT '{}',
  is_premium BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

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
  features JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lists (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  city_id VARCHAR(50) REFERENCES cities(id),
  category VARCHAR(100),
  description TEXT,
  curator VARCHAR(200),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_featured BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT true,
  venue_ids TEXT[] DEFAULT '{}',
  image_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS list_venues (
  list_id VARCHAR(50) REFERENCES lists(id) ON DELETE CASCADE,
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  notes TEXT,
  added_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (list_id, venue_id)
);

CREATE TABLE IF NOT EXISTS user_lists (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  list_id VARCHAR(50) REFERENCES lists(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, list_id)
);

CREATE TABLE IF NOT EXISTS saved_venues (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, venue_id)
);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, venue_id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id VARCHAR(50) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(500) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  venue_id VARCHAR(50) REFERENCES venues(id) ON DELETE CASCADE,
  interaction_type VARCHAR(50) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venues_city_id ON venues(city_id);
CREATE INDEX IF NOT EXISTS idx_venues_category ON venues(category);
CREATE INDEX IF NOT EXISTS idx_lists_city_id ON lists(city_id);
CREATE INDEX IF NOT EXISTS idx_lists_user_id ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_user_id ON user_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_venue_id ON user_interactions(venue_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id ON user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_venues_user_id ON saved_venues(user_id);
