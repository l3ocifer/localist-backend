-- Migration 014: Add Google Places API fields to venues table
-- These fields support enriched venue data from Google Places API

-- Google Place ID for deduplication and future updates
ALTER TABLE venues ADD COLUMN IF NOT EXISTS google_place_id VARCHAR(255) UNIQUE;

-- Additional venue metadata
ALTER TABLE venues ADD COLUMN IF NOT EXISTS review_count INTEGER;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(100);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS opening_hours JSONB;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual';

-- Index for Google Place ID lookups
CREATE INDEX IF NOT EXISTS idx_venues_google_place_id ON venues(google_place_id) WHERE google_place_id IS NOT NULL;

-- Index for neighborhood filtering
CREATE INDEX IF NOT EXISTS idx_venues_neighborhood ON venues(neighborhood) WHERE neighborhood IS NOT NULL;

-- Index for source tracking
CREATE INDEX IF NOT EXISTS idx_venues_source ON venues(source);

COMMENT ON COLUMN venues.google_place_id IS 'Google Places API place_id for deduplication';
COMMENT ON COLUMN venues.review_count IS 'Number of reviews from Google';
COMMENT ON COLUMN venues.neighborhood IS 'Neighborhood within the city';
COMMENT ON COLUMN venues.opening_hours IS 'Weekly opening hours from Google Places';
COMMENT ON COLUMN venues.source IS 'Data source: manual, google_places, perplexica, etc';

