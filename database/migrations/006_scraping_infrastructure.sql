-- Scraping Infrastructure Tables
-- For tracking scraping jobs, CSV imports, and content review queue

-- ============================================================================
-- SCRAPING JOBS TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS scraping_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('api_scrape', 'web_scrape', 'csv_import', 'manual_curation')),
  source_id VARCHAR(100) REFERENCES data_sources(id),
  city_id VARCHAR(50) REFERENCES cities(id),
  category VARCHAR(100),
  
  -- Job status
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  progress_percent INTEGER DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  
  -- Results
  venues_found INTEGER DEFAULT 0,
  venues_added INTEGER DEFAULT 0,
  venues_updated INTEGER DEFAULT 0,
  venues_failed INTEGER DEFAULT 0,
  
  -- Error tracking
  error_message TEXT,
  error_stack TEXT,
  
  -- Configuration
  config JSONB DEFAULT '{}',
  
  -- Timestamps
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- CSV IMPORT BATCHES
-- ============================================================================

CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(500) NOT NULL,
  file_size_bytes BIGINT,
  file_hash VARCHAR(64), -- SHA-256 hash for deduplication
  
  -- Import status
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'parsing', 'validating', 'importing', 'completed', 'failed')),
  progress_percent INTEGER DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  
  -- Results
  total_rows INTEGER DEFAULT 0,
  rows_processed INTEGER DEFAULT 0,
  rows_successful INTEGER DEFAULT 0,
  rows_failed INTEGER DEFAULT 0,
  
  -- Error tracking
  error_summary JSONB DEFAULT '[]', -- Array of {row, error, field} objects
  validation_errors JSONB DEFAULT '[]',
  
  -- Configuration
  mapping_config JSONB DEFAULT '{}', -- Column mapping configuration
  import_config JSONB DEFAULT '{}',
  
  -- Timestamps
  uploaded_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- CONTENT REVIEW QUEUE
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Content type and reference
  content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('venue', 'list', 'review', 'image')),
  content_id VARCHAR(200) NOT NULL, -- References venue id, list id, etc.
  source_id VARCHAR(100) REFERENCES data_sources(id),
  
  -- Review status
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'needs_changes')),
  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10), -- 1 = highest priority
  
  -- Review metadata
  submitted_by VARCHAR(200), -- User email or system identifier
  submitted_at TIMESTAMP DEFAULT NOW(),
  reviewed_by VARCHAR(200),
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  
  -- Content data snapshot (for review)
  content_snapshot JSONB NOT NULL,
  
  -- Flags
  requires_manual_review BOOLEAN DEFAULT false,
  is_duplicate BOOLEAN DEFAULT false,
  duplicate_of_id VARCHAR(200), -- If duplicate, reference to original
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Scraping jobs
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_status ON scraping_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_source ON scraping_jobs(source_id, status);
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_city ON scraping_jobs(city_id, status);
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_type ON scraping_jobs(job_type, status);

-- Import batches
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_hash ON import_batches(file_hash);

-- Content review queue
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON content_review_queue(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_review_queue_type ON content_review_queue(content_type, status);
CREATE INDEX IF NOT EXISTS idx_review_queue_content ON content_review_queue(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_source ON content_review_queue(source_id, status);
CREATE INDEX IF NOT EXISTS idx_review_queue_manual ON content_review_queue(requires_manual_review, status) WHERE requires_manual_review = true;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_scraping_jobs_updated_at BEFORE UPDATE ON scraping_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_import_batches_updated_at BEFORE UPDATE ON import_batches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_review_queue_updated_at BEFORE UPDATE ON content_review_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

