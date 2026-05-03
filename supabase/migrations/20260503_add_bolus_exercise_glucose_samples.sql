-- Task #194: Dichte CGM-Kurve auch für Bolus- und Exercise-Logs.
--
-- Mirrors the Task #187 meal_glucose_samples design with parallel
-- per-log-type tables (cleaner FK + RLS story than a generic
-- `log_glucose_samples (log_id, log_type, …)` table — meals already
-- ship with the parallel approach, so we follow the same pattern):
--
--   1. `bolus_glucose_samples`     — full 0–180 min CGM time series for
--      every bolus injection (basal logs are NOT scored, so they don't
--      get a curve).
--   2. `exercise_glucose_samples`  — full 0–180 min CGM time series
--      starting at the workout end (`created_at + duration_minutes`).
--   3. Derived window-level aggregates persisted on `insulin_logs` and
--      `exercise_logs` so the engine can read min/max/hypo/AUC without
--      re-joining samples on every render.
--   4. Two new `cgm_fetch_jobs.fetch_type` values — `bolus_curve_180`
--      and `exercise_curve_180` — for the +3h backfill jobs.
--
-- Idempotent. Safe to re-run.

-- ── bolus_glucose_samples ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bolus_glucose_samples (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id        uuid NOT NULL REFERENCES insulin_logs(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  t_offset_min  integer NOT NULL,
  value_mgdl    numeric(5,1) NOT NULL,
  source        text NOT NULL,
  captured_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (log_id, t_offset_min)
);

CREATE INDEX IF NOT EXISTS bolus_glucose_samples_log_idx
  ON bolus_glucose_samples (log_id, t_offset_min);
CREATE INDEX IF NOT EXISTS bolus_glucose_samples_user_idx
  ON bolus_glucose_samples (user_id);

ALTER TABLE bolus_glucose_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bgs_select_own" ON bolus_glucose_samples;
CREATE POLICY "bgs_select_own"
  ON bolus_glucose_samples FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "bgs_insert_own" ON bolus_glucose_samples;
CREATE POLICY "bgs_insert_own"
  ON bolus_glucose_samples FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "bgs_update_own" ON bolus_glucose_samples;
CREATE POLICY "bgs_update_own"
  ON bolus_glucose_samples FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "bgs_delete_own" ON bolus_glucose_samples;
CREATE POLICY "bgs_delete_own"
  ON bolus_glucose_samples FOR DELETE
  USING (auth.uid()::text = user_id);

-- ── exercise_glucose_samples ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exercise_glucose_samples (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id        uuid NOT NULL REFERENCES exercise_logs(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  t_offset_min  integer NOT NULL,
  value_mgdl    numeric(5,1) NOT NULL,
  source        text NOT NULL,
  captured_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (log_id, t_offset_min)
);

CREATE INDEX IF NOT EXISTS exercise_glucose_samples_log_idx
  ON exercise_glucose_samples (log_id, t_offset_min);
CREATE INDEX IF NOT EXISTS exercise_glucose_samples_user_idx
  ON exercise_glucose_samples (user_id);

ALTER TABLE exercise_glucose_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "egs_select_own" ON exercise_glucose_samples;
CREATE POLICY "egs_select_own"
  ON exercise_glucose_samples FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "egs_insert_own" ON exercise_glucose_samples;
CREATE POLICY "egs_insert_own"
  ON exercise_glucose_samples FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "egs_update_own" ON exercise_glucose_samples;
CREATE POLICY "egs_update_own"
  ON exercise_glucose_samples FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "egs_delete_own" ON exercise_glucose_samples;
CREATE POLICY "egs_delete_own"
  ON exercise_glucose_samples FOR DELETE
  USING (auth.uid()::text = user_id);

-- ── derived columns on insulin_logs / exercise_logs ──────────────────
ALTER TABLE insulin_logs
  ADD COLUMN IF NOT EXISTS min_bg_180        numeric(5,1),
  ADD COLUMN IF NOT EXISTS max_bg_180        numeric(5,1),
  ADD COLUMN IF NOT EXISTS time_to_peak_min  integer,
  ADD COLUMN IF NOT EXISTS auc_180           numeric(10,2),
  ADD COLUMN IF NOT EXISTS had_hypo_window   boolean,
  ADD COLUMN IF NOT EXISTS min_bg_60_180     numeric(5,1);

ALTER TABLE exercise_logs
  ADD COLUMN IF NOT EXISTS min_bg_180        numeric(5,1),
  ADD COLUMN IF NOT EXISTS max_bg_180        numeric(5,1),
  ADD COLUMN IF NOT EXISTS time_to_peak_min  integer,
  ADD COLUMN IF NOT EXISTS auc_180           numeric(10,2),
  ADD COLUMN IF NOT EXISTS had_hypo_window   boolean,
  ADD COLUMN IF NOT EXISTS min_bg_60_180     numeric(5,1);

-- ── extend the cgm_fetch_jobs.fetch_type check constraint ────────────
ALTER TABLE cgm_fetch_jobs
  DROP CONSTRAINT IF EXISTS cgm_fetch_jobs_fetch_type_check;
ALTER TABLE cgm_fetch_jobs
  ADD CONSTRAINT cgm_fetch_jobs_fetch_type_check CHECK (fetch_type IN (
    'before',
    'bg_1h','bg_2h',
    'after_1h','after_2h',
    'after_12h','after_24h',
    'at_end','exer_after_1h',
    'meal_curve_180',
    'bolus_curve_180',
    'exercise_curve_180'
  ));
