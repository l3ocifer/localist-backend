-- Add admin role support to users table
-- Task: Admin Authentication

-- Add is_admin column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'is_admin'
  ) THEN
    ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Create index for admin lookups
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin) WHERE is_admin = true;

-- Update existing admin user if exists (based on email)
UPDATE users SET is_admin = true WHERE email = 'admin@localist.ai';

-- Add comment
COMMENT ON COLUMN users.is_admin IS 'Whether user has admin privileges';

