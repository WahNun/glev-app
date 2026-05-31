-- carbs_grams was INTEGER in the initial meals schema; decimal values
-- arise when using Bread Units (BE) or Carb Exchanges (KE) where
-- 1 BE = 10 g, so 9.25 BE = 92.5 g — previously rejected by Postgres
-- with "invalid input syntax for type integer".
--
-- calories was added as int4 in 20260423_add_meal_macros.sql; the
-- computeCalories() helper produces floats (e.g. 92.5 * 4 = 370.0),
-- so it needs the same type lift.
--
-- protein_grams / fat_grams / fiber_grams were already numeric in that
-- same migration — no change needed for those.

ALTER TABLE meals
  ALTER COLUMN carbs_grams TYPE numeric,
  ALTER COLUMN calories     TYPE numeric;
