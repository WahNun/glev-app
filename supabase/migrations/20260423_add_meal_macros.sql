-- Add macro columns to meals table (idempotent — safe to re-run)
ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS glucose_after  int4,
  ADD COLUMN IF NOT EXISTS protein_grams  numeric,
  ADD COLUMN IF NOT EXISTS fat_grams      numeric,
  ADD COLUMN IF NOT EXISTS fiber_grams    numeric,
  ADD COLUMN IF NOT EXISTS calories       int4,
  ADD COLUMN IF NOT EXISTS meal_type      text;
