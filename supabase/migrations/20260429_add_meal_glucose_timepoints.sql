-- Post-meal multi-timepoint glucose readings.
-- Adds 5 reading columns (int4 mg/dL) + matching capture timestamps so
-- we can prompt the user for a BG value at 30min / 1h / 90min / 2h / 3h
-- after each meal and know exactly when the value was recorded.
--
-- Idempotent — safe to re-run.
-- Coexists with the existing `bg_1h`/`bg_2h` columns; we are *not*
-- backfilling or removing those here. Future cleanup task can migrate
-- bg_1h/bg_2h data into glucose_1h/glucose_2h and drop the old columns.
ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS glucose_30min     int4,
  ADD COLUMN IF NOT EXISTS glucose_30min_at  timestamptz,
  ADD COLUMN IF NOT EXISTS glucose_1h        int4,
  ADD COLUMN IF NOT EXISTS glucose_1h_at     timestamptz,
  ADD COLUMN IF NOT EXISTS glucose_90min     int4,
  ADD COLUMN IF NOT EXISTS glucose_90min_at  timestamptz,
  ADD COLUMN IF NOT EXISTS glucose_2h        int4,
  ADD COLUMN IF NOT EXISTS glucose_2h_at     timestamptz,
  ADD COLUMN IF NOT EXISTS glucose_3h        int4,
  ADD COLUMN IF NOT EXISTS glucose_3h_at     timestamptz;
