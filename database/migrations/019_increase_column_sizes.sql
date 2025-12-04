-- 019_increase_column_sizes.sql
-- Best practice: Use TEXT for URLs and descriptions (no arbitrary limits)
-- VARCHAR only for fields with known max lengths (IDs, codes, etc.)

-- Lists
ALTER TABLE lists ALTER COLUMN id TYPE VARCHAR(100);
ALTER TABLE lists ALTER COLUMN image_url TYPE TEXT;
ALTER TABLE lists ALTER COLUMN description TYPE TEXT;

-- List Venues (foreign key must match lists.id size)
ALTER TABLE list_venues ALTER COLUMN list_id TYPE VARCHAR(250);

-- Venues  
ALTER TABLE venues ALTER COLUMN phone TYPE VARCHAR(50);
ALTER TABLE venues ALTER COLUMN price_range TYPE VARCHAR(20);
ALTER TABLE venues ALTER COLUMN image_url TYPE TEXT;
ALTER TABLE venues ALTER COLUMN website TYPE TEXT;
ALTER TABLE venues ALTER COLUMN description TYPE TEXT;
ALTER TABLE venues ALTER COLUMN address TYPE TEXT;

-- Cities
ALTER TABLE cities ALTER COLUMN image_url TYPE TEXT;
ALTER TABLE cities ALTER COLUMN description TYPE TEXT;

