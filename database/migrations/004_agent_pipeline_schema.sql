-- Multi-Agent Data Pipeline Architecture
-- Medallion Architecture: Bronze (Raw) -> Silver (Cleaned) -> Gold (Curated)

-- ============================================================================
-- AGENT TRACKING & COORDINATION
-- ============================================================================

-- Agent Types: hunter (collectors), archivist (organizers), curator (list makers)
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('hunter', 'archivist', 'curator')),
  status VARCHAR(50) DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'paused', 'error')),
  config JSONB DEFAULT '{}',
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Agent execution logs
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL CHECK (status IN ('started', 'running', 'completed', 'failed')),
  records_processed INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- ============================================================================
-- BRONZE LAYER: RAW DATA INGESTION
-- ============================================================================

-- Data sources: eater38, michelin, yelp, reddit, google, instagram, etc.
CREATE TABLE IF NOT EXISTS data_sources (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('expert_list', 'consumer_review', 'social', 'search', 'manual')),
  authority_weight DECIMAL(3,2) DEFAULT 0.50, -- Used in weighted algorithm
  url VARCHAR(500),
  scrape_config JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_scraped_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Bronze: Raw venue data from all sources (untouched, duplicates expected)
CREATE TABLE IF NOT EXISTS bronze_venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id VARCHAR(100) REFERENCES data_sources(id),
  source_venue_id VARCHAR(200), -- ID from source system
  source_url VARCHAR(500),
  raw_data JSONB NOT NULL, -- Complete raw JSON from source
  
  -- Extracted fields (may be messy/inconsistent)
  name VARCHAR(500),
  address TEXT,
  city VARCHAR(200),
  state VARCHAR(100),
  postal_code VARCHAR(20),
  country VARCHAR(100),
  phone VARCHAR(100),
  website VARCHAR(500),
  cuisine VARCHAR(200),
  category VARCHAR(200),
  price_range VARCHAR(50),
  rating DECIMAL(3,2),
  review_count INTEGER,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  
  -- Processing status
  processing_status VARCHAR(50) DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'processed', 'error')),
  error_message TEXT,
  ingested_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  
  UNIQUE(source_id, source_venue_id)
);

-- Bronze: Raw list data from sources (Eater 38, Michelin Guide, etc.)
CREATE TABLE IF NOT EXISTS bronze_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id VARCHAR(100) REFERENCES data_sources(id),
  source_list_id VARCHAR(200),
  source_url VARCHAR(500),
  raw_data JSONB NOT NULL,
  
  -- Extracted fields
  name VARCHAR(500),
  description TEXT,
  city VARCHAR(200),
  category VARCHAR(200),
  curator VARCHAR(200),
  venue_count INTEGER,
  published_date DATE,
  
  processing_status VARCHAR(50) DEFAULT 'pending',
  error_message TEXT,
  ingested_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  
  UNIQUE(source_id, source_list_id)
);

-- Bronze: Raw review data from consumer sources
CREATE TABLE IF NOT EXISTS bronze_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id VARCHAR(100) REFERENCES data_sources(id),
  source_review_id VARCHAR(200),
  source_venue_id VARCHAR(200),
  source_url VARCHAR(500),
  raw_data JSONB NOT NULL,
  
  -- Extracted fields
  venue_name VARCHAR(500),
  rating DECIMAL(3,2),
  review_text TEXT,
  reviewer_name VARCHAR(200),
  review_date DATE,
  helpful_count INTEGER,
  
  processing_status VARCHAR(50) DEFAULT 'pending',
  ingested_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  
  UNIQUE(source_id, source_review_id)
);

-- ============================================================================
-- SILVER LAYER: CLEANED & DEDUPLICATED DATA
-- ============================================================================

-- Silver: Master venue registry (deduplicated, cleaned, normalized)
CREATE TABLE IF NOT EXISTS silver_venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Normalized venue information
  canonical_name VARCHAR(300) NOT NULL,
  normalized_address TEXT,
  city_id VARCHAR(50) REFERENCES cities(id),
  postal_code VARCHAR(20),
  country_code VARCHAR(10),
  phone VARCHAR(50),
  website VARCHAR(500),
  coordinates JSONB NOT NULL, -- {lat, lng}
  
  -- Classification
  primary_cuisine VARCHAR(100),
  secondary_cuisines TEXT[],
  primary_category VARCHAR(100),
  categories TEXT[],
  price_level INTEGER CHECK (price_level BETWEEN 1 AND 4),
  
  -- Aggregated metrics
  aggregated_rating DECIMAL(3,2),
  total_review_count INTEGER DEFAULT 0,
  expert_score DECIMAL(5,2), -- Weighted score from expert sources
  consumer_score DECIMAL(5,2), -- Weighted score from consumer reviews
  
  -- Quality flags
  is_verified BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  confidence_score DECIMAL(3,2), -- How confident we are in deduplication
  
  -- Metadata
  tags TEXT[],
  features TEXT[],
  hours JSONB,
  photos JSONB DEFAULT '[]',
  
  -- Tracking
  first_seen_at TIMESTAMP DEFAULT NOW(),
  last_updated_at TIMESTAMP DEFAULT NOW(),
  last_verified_at TIMESTAMP,
  
  -- Source tracking
  source_count INTEGER DEFAULT 0, -- How many sources mention this venue
  bronze_venue_ids UUID[] -- References to bronze_venues
);

-- Venue source mapping (which bronze records map to which silver venue)
CREATE TABLE IF NOT EXISTS venue_source_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  silver_venue_id UUID REFERENCES silver_venues(id) ON DELETE CASCADE,
  bronze_venue_id UUID REFERENCES bronze_venues(id) ON DELETE CASCADE,
  source_id VARCHAR(100) REFERENCES data_sources(id),
  confidence_score DECIMAL(3,2) DEFAULT 1.00,
  matched_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(silver_venue_id, bronze_venue_id)
);

-- Silver: Deduplicated and normalized reviews
CREATE TABLE IF NOT EXISTS silver_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  silver_venue_id UUID REFERENCES silver_venues(id) ON DELETE CASCADE,
  source_id VARCHAR(100) REFERENCES data_sources(id),
  
  rating DECIMAL(3,2) NOT NULL,
  review_text TEXT,
  reviewer_name VARCHAR(200),
  review_date DATE,
  sentiment_score DECIMAL(3,2), -- -1 to 1, from sentiment analysis
  
  bronze_review_ids UUID[],
  created_at TIMESTAMP DEFAULT NOW()
);

-- Silver: Source mentions (tracking which lists/articles mention venues)
CREATE TABLE IF NOT EXISTS silver_venue_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  silver_venue_id UUID REFERENCES silver_venues(id) ON DELETE CASCADE,
  source_id VARCHAR(100) REFERENCES data_sources(id),
  bronze_list_id UUID REFERENCES bronze_lists(id),
  
  mention_type VARCHAR(50) CHECK (mention_type IN ('list_inclusion', 'article_feature', 'award', 'recommendation')),
  list_name VARCHAR(500),
  list_position INTEGER, -- Position in original list (1 = #1, etc.)
  mention_context TEXT,
  mention_date DATE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(silver_venue_id, source_id, bronze_list_id)
);

-- ============================================================================
-- GOLD LAYER: CURATED OUTPUT
-- ============================================================================

-- Weighting algorithms for list curation
CREATE TABLE IF NOT EXISTS curation_algorithms (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  version VARCHAR(50) NOT NULL,
  
  -- Weights configuration
  expert_weight DECIMAL(3,2) DEFAULT 0.70, -- Weight for expert sources (Eater, Michelin, etc.)
  consumer_weight DECIMAL(3,2) DEFAULT 0.30, -- Weight for consumer reviews (Yelp, Google)
  recency_weight DECIMAL(3,2) DEFAULT 0.20, -- How much to factor in recency
  source_weights JSONB DEFAULT '{}', -- Per-source weights override
  
  -- Algorithm parameters
  min_source_count INTEGER DEFAULT 2, -- Minimum sources to include venue
  min_confidence_score DECIMAL(3,2) DEFAULT 0.70,
  boost_factors JSONB DEFAULT '{}', -- Additional boost factors
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Gold: Curated lists (final output for consumers)
CREATE TABLE IF NOT EXISTS gold_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id VARCHAR(50) UNIQUE, -- Public-facing ID
  
  name VARCHAR(200) NOT NULL,
  description TEXT,
  city_id VARCHAR(50) REFERENCES cities(id),
  category VARCHAR(100),
  
  -- Curation metadata
  algorithm_id VARCHAR(100) REFERENCES curation_algorithms(id),
  curator_agent_id UUID REFERENCES agents(id),
  curation_score DECIMAL(5,2), -- Overall quality score of this list
  
  -- List configuration
  target_venue_count INTEGER DEFAULT 20,
  actual_venue_count INTEGER,
  
  -- Status
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived')),
  is_featured BOOLEAN DEFAULT false,
  
  -- Publishing
  published_at TIMESTAMP,
  last_curated_at TIMESTAMP,
  next_curation_at TIMESTAMP, -- When to re-run curation
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Gold: List items (venues in curated lists with their scores)
CREATE TABLE IF NOT EXISTS gold_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gold_list_id UUID REFERENCES gold_lists(id) ON DELETE CASCADE,
  silver_venue_id UUID REFERENCES silver_venues(id) ON DELETE CASCADE,
  
  position INTEGER NOT NULL, -- 1-based position in list
  
  -- Scoring breakdown
  final_score DECIMAL(5,2) NOT NULL,
  expert_score DECIMAL(5,2),
  consumer_score DECIMAL(5,2),
  recency_score DECIMAL(5,2),
  boost_score DECIMAL(5,2),
  score_breakdown JSONB, -- Detailed scoring information
  
  -- Justification (for transparency)
  included_reason TEXT,
  source_mentions INTEGER, -- How many sources mentioned this venue
  top_sources TEXT[], -- Top sources that mentioned this
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(gold_list_id, silver_venue_id),
  UNIQUE(gold_list_id, position)
);

-- Gold: Algorithm performance tracking
CREATE TABLE IF NOT EXISTS algorithm_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  algorithm_id VARCHAR(100) REFERENCES curation_algorithms(id),
  gold_list_id UUID REFERENCES gold_lists(id),
  
  -- Performance metrics
  list_quality_score DECIMAL(3,2), -- 0-1, how good is this list
  user_engagement_score DECIMAL(3,2), -- Based on clicks, saves, etc.
  expert_validation_score DECIMAL(3,2), -- Manual review by expert (David)
  
  -- Comparison
  venues_added INTEGER,
  venues_removed INTEGER,
  average_position_change DECIMAL(5,2),
  
  notes TEXT,
  evaluated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- DUPLICATE DETECTION & MATCHING
-- ============================================================================

-- Potential duplicate venues (for archivist agents to review)
CREATE TABLE IF NOT EXISTS potential_duplicates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_a_id UUID, -- Could be bronze or silver
  venue_b_id UUID,
  venue_layer VARCHAR(10) CHECK (venue_layer IN ('bronze', 'silver')),
  
  -- Similarity scores
  name_similarity DECIMAL(3,2),
  address_similarity DECIMAL(3,2),
  phone_similarity DECIMAL(3,2),
  distance_meters DECIMAL(10,2),
  overall_similarity DECIMAL(3,2),
  
  -- Resolution
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'duplicate', 'not_duplicate', 'needs_review')),
  resolved_by UUID REFERENCES agents(id),
  resolution_notes TEXT,
  resolved_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(venue_a_id, venue_b_id, venue_layer)
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Agent tracking
CREATE INDEX idx_agents_type_status ON agents(type, status);
CREATE INDEX idx_agent_runs_agent_id ON agent_runs(agent_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status, started_at DESC);

-- Bronze layer
CREATE INDEX idx_bronze_venues_source ON bronze_venues(source_id, processing_status);
CREATE INDEX idx_bronze_venues_status ON bronze_venues(processing_status, ingested_at DESC);
CREATE INDEX idx_bronze_venues_city ON bronze_venues(city, processing_status);
CREATE INDEX idx_bronze_lists_source ON bronze_lists(source_id, processing_status);
CREATE INDEX idx_bronze_reviews_status ON bronze_reviews(processing_status);

-- Silver layer
CREATE INDEX idx_silver_venues_city ON silver_venues(city_id);
CREATE INDEX idx_silver_venues_category ON silver_venues(primary_category);
CREATE INDEX idx_silver_venues_cuisine ON silver_venues(primary_cuisine);
CREATE INDEX idx_silver_venues_score ON silver_venues(expert_score DESC, consumer_score DESC);
CREATE INDEX idx_silver_venues_active ON silver_venues(is_active, is_verified);
CREATE INDEX idx_venue_mapping_silver ON venue_source_mapping(silver_venue_id);
CREATE INDEX idx_venue_mapping_bronze ON venue_source_mapping(bronze_venue_id);
CREATE INDEX idx_silver_mentions_venue ON silver_venue_mentions(silver_venue_id);
CREATE INDEX idx_silver_mentions_source ON silver_venue_mentions(source_id);
CREATE INDEX idx_silver_reviews_venue ON silver_reviews(silver_venue_id);

-- Gold layer
CREATE INDEX idx_gold_lists_city ON gold_lists(city_id, status);
CREATE INDEX idx_gold_lists_status ON gold_lists(status, published_at DESC);
CREATE INDEX idx_gold_lists_algorithm ON gold_lists(algorithm_id);
CREATE INDEX idx_gold_list_items_list ON gold_list_items(gold_list_id, position);
CREATE INDEX idx_gold_list_items_venue ON gold_list_items(silver_venue_id);
CREATE INDEX idx_gold_list_items_score ON gold_list_items(final_score DESC);

-- Duplicates
CREATE INDEX idx_duplicates_status ON potential_duplicates(status, overall_similarity DESC);
CREATE INDEX idx_duplicates_venues ON potential_duplicates(venue_a_id, venue_b_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_gold_lists_updated_at BEFORE UPDATE ON gold_lists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_curation_algorithms_updated_at BEFORE UPDATE ON curation_algorithms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

