-- 020_features_to_jsonb.sql
-- Standardize features column to JSONB (matching local dev schema)

-- Convert text[] to jsonb if it exists as text[]
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'venues' 
        AND column_name = 'features' 
        AND data_type = 'ARRAY'
    ) THEN
        -- Convert existing text[] data to jsonb
        ALTER TABLE venues 
        ALTER COLUMN features TYPE jsonb 
        USING COALESCE(to_jsonb(features), '[]'::jsonb);
        
        -- Set default
        ALTER TABLE venues 
        ALTER COLUMN features SET DEFAULT '[]'::jsonb;
    END IF;
END $$;

