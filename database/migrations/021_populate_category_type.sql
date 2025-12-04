-- Migration: Populate category_type field for lists based on category
-- This enables filtering by Cuisines, Dishes, and Occasions on the frontend

-- First, add category_type column if it doesn't exist
ALTER TABLE lists ADD COLUMN IF NOT EXISTS category_type VARCHAR(50);

-- Occasions (events, times, purposes)
UPDATE lists SET category_type = 'occasion' WHERE category_type IS NULL AND (
  LOWER(category) LIKE '%happy hour%' OR
  LOWER(category) LIKE '%brunch%' OR
  LOWER(category) LIKE '%date night%' OR
  LOWER(category) LIKE '%breakfast%' OR
  LOWER(category) LIKE '%lunch%' OR
  LOWER(category) LIKE '%dinner%' OR
  LOWER(category) LIKE '%late night%' OR
  LOWER(category) LIKE '%weekend%' OR
  LOWER(category) LIKE '%birthday%' OR
  LOWER(category) LIKE '%celebration%' OR
  LOWER(category) LIKE '%romantic%' OR
  LOWER(category) LIKE '%family%' OR
  LOWER(category) LIKE '%group%' OR
  LOWER(category) LIKE '%outdoor%' OR
  LOWER(category) LIKE '%rooftop%' OR
  LOWER(category) LIKE '%patio%'
);

-- Cuisines (regional/ethnic food styles)
UPDATE lists SET category_type = 'cuisine' WHERE category_type IS NULL AND (
  LOWER(category) LIKE '%american%' OR
  LOWER(category) LIKE '%italian%' OR
  LOWER(category) LIKE '%mexican%' OR
  LOWER(category) LIKE '%chinese%' OR
  LOWER(category) LIKE '%japanese%' OR
  LOWER(category) LIKE '%korean%' OR
  LOWER(category) LIKE '%thai%' OR
  LOWER(category) LIKE '%vietnamese%' OR
  LOWER(category) LIKE '%indian%' OR
  LOWER(category) LIKE '%french%' OR
  LOWER(category) LIKE '%spanish%' OR
  LOWER(category) LIKE '%mediterranean%' OR
  LOWER(category) LIKE '%greek%' OR
  LOWER(category) LIKE '%middle eastern%' OR
  LOWER(category) LIKE '%cajun%' OR
  LOWER(category) LIKE '%creole%' OR
  LOWER(category) LIKE '%southern%' OR
  LOWER(category) LIKE '%bbq%' OR
  LOWER(category) LIKE '%barbecue%' OR
  LOWER(category) LIKE '%seafood%' OR
  LOWER(category) LIKE '%steakhouse%' OR
  LOWER(category) LIKE '%tex-mex%'
);

-- Signature Dishes (specific food items)
UPDATE lists SET category_type = 'signature_dish' WHERE category_type IS NULL AND (
  LOWER(category) LIKE '%pizza%' OR
  LOWER(category) LIKE '%burger%' OR
  LOWER(category) LIKE '%hamburger%' OR
  LOWER(category) LIKE '%taco%' OR
  LOWER(category) LIKE '%sushi%' OR
  LOWER(category) LIKE '%ramen%' OR
  LOWER(category) LIKE '%pho%' OR
  LOWER(category) LIKE '%pasta%' OR
  LOWER(category) LIKE '%steak%' OR
  LOWER(category) LIKE '%wings%' OR
  LOWER(category) LIKE '%sandwich%' OR
  LOWER(category) LIKE '%salad%' OR
  LOWER(category) LIKE '%soup%' OR
  LOWER(category) LIKE '%noodle%' OR
  LOWER(category) LIKE '%dumpling%' OR
  LOWER(category) LIKE '%curry%' OR
  LOWER(category) LIKE '%fried chicken%' OR
  LOWER(category) LIKE '%hot dog%' OR
  LOWER(category) LIKE '%bagel%' OR
  LOWER(category) LIKE '%croissant%' OR
  LOWER(category) LIKE '%donut%' OR
  LOWER(category) LIKE '%ice cream%' OR
  LOWER(category) LIKE '%coffee%' OR
  LOWER(category) LIKE '%cocktail%' OR
  LOWER(category) LIKE '%wine%' OR
  LOWER(category) LIKE '%beer%' OR
  LOWER(category) LIKE '%dim sum%' OR
  LOWER(category) LIKE '%poke%' OR
  LOWER(category) LIKE '%omakase%' OR
  LOWER(category) LIKE '%paella%' OR
  LOWER(category) LIKE '%kimchi%' OR
  LOWER(category) LIKE '%meatball%' OR
  LOWER(category) LIKE '%cheesesteak%' OR
  LOWER(category) LIKE '%philly%' OR
  LOWER(category) LIKE '%burrito%' OR
  LOWER(category) LIKE '%peking duck%'
);

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_lists_category_type ON lists(category_type);
CREATE INDEX IF NOT EXISTS idx_lists_city_category_type ON lists(city_id, category_type);

