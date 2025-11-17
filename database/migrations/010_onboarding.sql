-- Add onboarding completion flag to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

-- Create index for onboarding queries
CREATE INDEX IF NOT EXISTS idx_users_onboarding_completed ON users(onboarding_completed);

-- Update existing users to have onboarding_completed = false (they can complete it if they want)
UPDATE users SET onboarding_completed = false WHERE onboarding_completed IS NULL;

