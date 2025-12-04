-- Create neighborhoods table for detailed neighborhood data
-- Each city has multiple neighborhoods that venues belong to

CREATE TABLE IF NOT EXISTS neighborhoods (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  city_id VARCHAR(50) NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  description TEXT,
  coordinates JSONB,
  image_url TEXT,
  bounds JSONB, -- GeoJSON polygon for neighborhood boundaries
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_neighborhoods_city ON neighborhoods(city_id);
CREATE INDEX IF NOT EXISTS idx_neighborhoods_name ON neighborhoods(name);

-- Add foreign key from venues to neighborhoods (optional reference)
ALTER TABLE venues 
  ADD COLUMN IF NOT EXISTS neighborhood_id VARCHAR(50) REFERENCES neighborhoods(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_venues_neighborhood_id ON venues(neighborhood_id) WHERE neighborhood_id IS NOT NULL;

-- Comments
COMMENT ON TABLE neighborhoods IS 'Neighborhoods within cities - used for filtering and grouping venues';
COMMENT ON COLUMN neighborhoods.bounds IS 'GeoJSON polygon defining the neighborhood boundaries';
COMMENT ON COLUMN venues.neighborhood_id IS 'Reference to the neighborhoods table (optional)';

