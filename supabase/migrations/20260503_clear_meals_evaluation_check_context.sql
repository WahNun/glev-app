-- Task #193: Phantom-Outcome `CHECK_CONTEXT` aus dem Engine-Modell entfernen.
-- The `CHECK_CONTEXT` outcome is no longer produced by `evaluateEntry` /
-- `lifecycleFor` and has been removed from the `Outcome` union, the
-- AdaptiveICR weight table and all UI lookup tables. Any historical
-- `meals.evaluation` rows still carrying the string would now render as
-- the unknown / OTHER bucket. Reset them to NULL so the next read
-- re-evaluates the row through `lifecycleFor` and writes a fresh,
-- canonical outcome.
UPDATE meals
SET evaluation = NULL
WHERE evaluation = 'CHECK_CONTEXT';
