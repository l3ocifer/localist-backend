-- Migration: Add google_maps_url column to venues table
-- For storing direct Google Maps links

ALTER TABLE venues ADD COLUMN IF NOT EXISTS google_maps_url VARCHAR(512);

COMMENT ON COLUMN venues.google_maps_url IS 'Direct link to Google Maps for the venue';

