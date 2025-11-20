-- Scraping Infrastructure Schema
-- Supports scraping job tracking, CSV imports, and content review queue

-- ============================================================================
-- SCRAPING JOB TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS scraping_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('venue_scrape', 'list_scrape', 'review_scrape', 'bulk_import')),
  source_id VARCHAR(100) REFERENCES data_sources(id),
  city_id VARCHAR(50) REFERENCES cities(id),
  category VARCHAR(100),
  
  -- Job status
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  
  -- Metrics
  records_found INTEGER DEFAULT 0,
  records_processed INTEGER DEFAULT 0,
  records_added INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  
  -- Configuration
  config JSONB DEFAULT '{}',
  error_message TEXT,
  error_details JSONB,
  
  -- Timing
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  
  -- Indexes
  CONSTRAINT scraping_jobs_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX idx_scraping_jobs_status ON scraping_jobs(status, created_at DESC);
CREATE INDEX idx_scraping_jobs_source ON scraping_jobs(source_id, status);
CREATE INDEX idx_scraping_jobs_city ON scraping_jobs(city_id, status);
CREATE INDEX idx_scraping_jobs_type ON scraping_jobs(job_type, status);

-- ============================================================================
-- CSV IMPORT BATCHES
-- ============================================================================

CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_name VARCHAR(200) NOT NULL,
  file_name VARCHAR(500) NOT NULL,
  file_size_bytes BIGINT,
  file_type VARCHAR(50) DEFAULT 'csv',
  
  -- Import status
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'parsing', 'validating', 'importing', 'completed', 'failed', 'cancelled')),
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  
  -- Metrics
  total_rows INTEGER DEFAULT 0,
  rows_processed INTEGER DEFAULT 0,
  rows_successful INTEGER DEFAULT 0,
  rows_failed INTEGER DEFAULT 0,
  
  -- Configuration
  mapping_config JSONB DEFAULT '{}', -- Column mappings
  validation_rules JSONB DEFAULT '{}',
  
  -- Results
  error_summary JSONB, -- Summary of errors
  failed_rows JSONB, -- Array of failed row data with errors
  
  -- File storage
  file_path VARCHAR(1000), -- Path to uploaded file
  file_url VARCHAR(1000), -- URL if stored in S3/MinIO
  
  -- Timing
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  
  CONSTRAINT import_batches_status_check CHECK (status IN ('pending', 'parsing', 'validating', 'importing', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX idx_import_batches_status ON import_batches(status, created_at DESC);
CREATE INDEX idx_import_batches_created_by ON import_batches(created_by, status);

-- ============================================================================
-- CONTENT REVIEW QUEUE
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Content type and reference
  content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('venue', 'list', 'review', 'image', 'merchant_submission')),
  content_id VARCHAR(200) NOT NULL, -- ID of the content (venue_id, list_id, etc.)
  source_id VARCHAR(100) REFERENCES data_sources(id),
  
  -- Review status
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'needs_changes')),
  priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  
  -- Review metadata
  review_notes TEXT,
  rejection_reason TEXT,
  suggested_changes JSONB,
  
  -- Reviewer tracking
  assigned_to UUID REFERENCES users(id),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  
  -- Content preview
  content_preview JSONB, -- Snapshot of content for review
  
  -- Timing
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT content_review_queue_status_check CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'needs_changes'))
);

CREATE INDEX idx_content_review_queue_status ON content_review_queue(status, priority DESC, created_at ASC);
CREATE INDEX idx_content_review_queue_type ON content_review_queue(content_type, status);
CREATE INDEX idx_content_review_queue_assigned ON content_review_queue(assigned_to, status);
CREATE INDEX idx_content_review_queue_content ON content_review_queue(content_type, content_id);

-- ============================================================================
-- SCRAPING JOB LOGS (for detailed tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS scraping_job_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES scraping_jobs(id) ON DELETE CASCADE,
  
  log_level VARCHAR(20) NOT NULL CHECK (log_level IN ('debug', 'info', 'warn', 'error')),
  message TEXT NOT NULL,
  metadata JSONB,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_scraping_job_logs_job ON scraping_job_logs(job_id, created_at DESC);
CREATE INDEX idx_scraping_job_logs_level ON scraping_job_logs(log_level, created_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_content_review_queue_updated_at BEFORE UPDATE ON content_review_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE scraping_jobs IS 'Tracks all scraping jobs with status and metrics';
COMMENT ON TABLE import_batches IS 'Tracks CSV import batches with validation and error reporting';
COMMENT ON TABLE content_review_queue IS 'Queue for content that needs manual review before publishing';
COMMENT ON TABLE scraping_job_logs IS 'Detailed logs for scraping jobs';



