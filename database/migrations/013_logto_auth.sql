-- Migration 013: Logto Authentication Integration
-- Adds support for Logto OIDC authentication

-- Add logto_sub column for storing Logto subject identifier
ALTER TABLE users ADD COLUMN IF NOT EXISTS logto_sub VARCHAR(255) UNIQUE;

-- Add avatar_url for profile pictures from social logins
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);

-- Add last_login for tracking user activity
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

-- Create index for faster lookups by logto_sub
CREATE INDEX IF NOT EXISTS idx_users_logto_sub ON users(logto_sub);

-- Add comment for documentation
COMMENT ON COLUMN users.logto_sub IS 'Logto OIDC subject identifier for SSO authentication';
COMMENT ON COLUMN users.avatar_url IS 'User profile picture URL from social login provider';
COMMENT ON COLUMN users.last_login IS 'Timestamp of last user login';

-- Make password_hash nullable since Logto handles authentication
-- (existing users will keep their passwords for backward compatibility)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

