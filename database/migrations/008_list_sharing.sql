-- Add sharing columns to user_lists table
ALTER TABLE user_lists 
ADD COLUMN IF NOT EXISTS share_token VARCHAR(255) UNIQUE;

-- Create index for share token lookups
CREATE INDEX IF NOT EXISTS idx_user_lists_share_token ON user_lists(share_token);

-- Add view_count column for tracking list popularity
ALTER TABLE user_lists
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;

-- Create list_views table for tracking individual views
CREATE TABLE IF NOT EXISTS list_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  list_id VARCHAR(50) REFERENCES user_lists(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  viewed_at TIMESTAMP DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent TEXT
);

-- Index for list views
CREATE INDEX IF NOT EXISTS idx_list_views_list_id ON list_views(list_id);
CREATE INDEX IF NOT EXISTS idx_list_views_viewed_at ON list_views(viewed_at DESC);

