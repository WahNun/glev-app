-- Task #187: Dichte CGM-Kurve pro Mahlzeit + neuer Outcome HYPO_DURING.
--
-- Adds:
--   1. `meal_glucose_samples` — full 0–180 min glucose time series per meal
--      in the native CGM cadence (LLU ~1/min, Dexcom/Nightscout ~5/min).
--   2. Derived columns on `meals` so the engine + insights can read
--      window-level aggregates without re-joining the samples table on
--      every render.
--   3. New `meal_curve_180` value in the `cgm_fetch_jobs.fetch_type`
--      check constraint — the +3h job that backfills the full curve.
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS meal_glucose_samples (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id       uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  t_offset_min  integer NOT NULL,
  value_mgdl    numeric(5,1) NOT NULL,
  source        text NOT NULL,
  captured_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meal_id, t_offset_min)
);

CREATE INDEX IF NOT EXISTS meal_glucose_samples_meal_idx
  ON meal_glucose_samples (meal_id, t_offset_min);
CREATE INDEX IF NOT EXISTS meal_glucose_samples_user_idx
  ON meal_glucose_samples (user_id);

ALTER TABLE meal_glucose_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mgs_select_own" ON meal_glucose_samples;
CREATE POLICY "mgs_select_own"
  ON meal_glucose_samples FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "mgs_insert_own" ON meal_glucose_samples;
CREATE POLICY "mgs_insert_own"
  ON meal_glucose_samples FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "mgs_update_own" ON meal_glucose_samples;
CREATE POLICY "mgs_update_own"
  ON meal_glucose_samples FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "mgs_delete_own" ON meal_glucose_samples;
CREATE POLICY "mgs_delete_own"
  ON meal_glucose_samples FOR DELETE
  USING (auth.uid()::text = user_id);

-- Derived window-level aggregates persisted on `meals` so the engine
-- + insights don't re-join samples on every render. Populated by the
-- `meal_curve_180` job once the full window has accumulated.
ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS min_bg_180        numeric(5,1),
  ADD COLUMN IF NOT EXISTS max_bg_180        numeric(5,1),
  ADD COLUMN IF NOT EXISTS time_to_peak_min  integer,
  ADD COLUMN IF NOT EXISTS auc_180           numeric(10,2),
  ADD COLUMN IF NOT EXISTS had_hypo_window   boolean,
  ADD COLUMN IF NOT EXISTS min_bg_60_180     numeric(5,1);

-- Extend the cgm_fetch_jobs.fetch_type check to allow the new
-- `meal_curve_180` value used by the +3h backfill job.
ALTER TABLE cgm_fetch_jobs
  DROP CONSTRAINT IF EXISTS cgm_fetch_jobs_fetch_type_check;
ALTER TABLE cgm_fetch_jobs
  ADD CONSTRAINT cgm_fetch_jobs_fetch_type_check CHECK (fetch_type IN (
    'before',
    'bg_1h','bg_2h',
    'after_1h','after_2h',
    'after_12h','after_24h',
    'at_end','exer_after_1h',
    'meal_curve_180'
  ));
