-- Migration: Create merchant tables
-- Description: Tables for merchant dashboard features

-- Merchant profiles table
CREATE TABLE IF NOT EXISTS merchant_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL UNIQUE,
    business_name VARCHAR(255) NOT NULL,
    business_email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    website VARCHAR(500),
    description TEXT,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Merchant venues (claimed venues)
CREATE TABLE IF NOT EXISTS merchant_venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchant_profiles(id) ON DELETE CASCADE,
    venue_id VARCHAR(255) NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    is_claimed BOOLEAN DEFAULT false,
    claim_status VARCHAR(50) DEFAULT 'pending' CHECK (claim_status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(merchant_id, venue_id)
);

-- Happy hours table
CREATE TABLE IF NOT EXISTS happy_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id VARCHAR(255) NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    day_of_week INTEGER[] NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    deals TEXT,
    menu_url VARCHAR(500),
    image_url VARCHAR(500),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'active', 'expired')),
    starts_at DATE,
    ends_at DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Pop-up events table
CREATE TABLE IF NOT EXISTS pop_up_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id VARCHAR(255) NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME,
    image_url VARCHAR(500),
    ticket_url VARCHAR(500),
    price VARCHAR(100),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'active', 'expired')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Merchant submissions (for admin review - happy hours and pop-ups)
CREATE TABLE IF NOT EXISTS merchant_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchant_profiles(id) ON DELETE CASCADE,
    venue_id VARCHAR(255) REFERENCES venues(id) ON DELETE SET NULL,
    submission_type VARCHAR(50) NOT NULL CHECK (submission_type IN ('happy_hour', 'pop_up')),
    reference_id UUID, -- References happy_hours or pop_up_events
    title VARCHAR(255) NOT NULL,
    description TEXT,
    image_url VARCHAR(500),
    start_date DATE,
    end_date DATE,
    hours JSONB,
    menu_url VARCHAR(500),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    payment_status VARCHAR(50),
    stripe_payment_id VARCHAR(255),
    rejection_reason TEXT,
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_merchant_profiles_user_id ON merchant_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_merchant_profiles_status ON merchant_profiles(status);
CREATE INDEX IF NOT EXISTS idx_merchant_venues_merchant_id ON merchant_venues(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_venues_venue_id ON merchant_venues(venue_id);
CREATE INDEX IF NOT EXISTS idx_happy_hours_venue_id ON happy_hours(venue_id);
CREATE INDEX IF NOT EXISTS idx_happy_hours_status ON happy_hours(status);
CREATE INDEX IF NOT EXISTS idx_pop_up_events_venue_id ON pop_up_events(venue_id);
CREATE INDEX IF NOT EXISTS idx_pop_up_events_status ON pop_up_events(status);
CREATE INDEX IF NOT EXISTS idx_pop_up_events_date ON pop_up_events(event_date);
CREATE INDEX IF NOT EXISTS idx_merchant_submissions_merchant_id ON merchant_submissions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_submissions_status ON merchant_submissions(status);

-- Add is_admin column to users if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Comments
COMMENT ON TABLE merchant_profiles IS 'Merchant business profiles for venue owners';
COMMENT ON TABLE merchant_venues IS 'Venues claimed by merchants';
COMMENT ON TABLE happy_hours IS 'Happy hour promotions for venues';
COMMENT ON TABLE pop_up_events IS 'Pop-up events at venues';
COMMENT ON TABLE merchant_submissions IS 'Merchant submissions for admin review';

