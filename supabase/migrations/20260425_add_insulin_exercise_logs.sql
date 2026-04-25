-- Insulin & Exercise logging tables.
-- Both are standalone event logs separate from meals.* — used by the Engine
-- "Log" tab and by Insights cards. Idempotent (safe to re-run).

-- =============================================================
-- insulin_logs
-- =============================================================
CREATE TABLE IF NOT EXISTS insulin_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  insulin_type        text NOT NULL CHECK (insulin_type IN ('bolus','basal')),
  insulin_name        text NOT NULL,
  units               numeric(5,2) NOT NULL CHECK (units > 0 AND units <= 100),
  cgm_glucose_at_log  numeric(5,1),
  notes               text
);

CREATE INDEX IF NOT EXISTS insulin_logs_user_created_idx
  ON insulin_logs (user_id, created_at DESC);

ALTER TABLE insulin_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insulin_logs_select_own" ON insulin_logs;
CREATE POLICY "insulin_logs_select_own"
  ON insulin_logs FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "insulin_logs_insert_own" ON insulin_logs;
CREATE POLICY "insulin_logs_insert_own"
  ON insulin_logs FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "insulin_logs_update_own" ON insulin_logs;
CREATE POLICY "insulin_logs_update_own"
  ON insulin_logs FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "insulin_logs_delete_own" ON insulin_logs;
CREATE POLICY "insulin_logs_delete_own"
  ON insulin_logs FOR DELETE
  USING (auth.uid()::text = user_id);

-- =============================================================
-- exercise_logs
-- =============================================================
CREATE TABLE IF NOT EXISTS exercise_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  exercise_type       text NOT NULL CHECK (exercise_type IN ('hypertrophy','cardio')),
  duration_minutes    integer NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 600),
  intensity           text NOT NULL CHECK (intensity IN ('low','medium','high')),
  cgm_glucose_at_log  numeric(5,1),
  notes               text
);

CREATE INDEX IF NOT EXISTS exercise_logs_user_created_idx
  ON exercise_logs (user_id, created_at DESC);

ALTER TABLE exercise_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exercise_logs_select_own" ON exercise_logs;
CREATE POLICY "exercise_logs_select_own"
  ON exercise_logs FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "exercise_logs_insert_own" ON exercise_logs;
CREATE POLICY "exercise_logs_insert_own"
  ON exercise_logs FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "exercise_logs_update_own" ON exercise_logs;
CREATE POLICY "exercise_logs_update_own"
  ON exercise_logs FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "exercise_logs_delete_own" ON exercise_logs;
CREATE POLICY "exercise_logs_delete_own"
  ON exercise_logs FOR DELETE
  USING (auth.uid()::text = user_id);
