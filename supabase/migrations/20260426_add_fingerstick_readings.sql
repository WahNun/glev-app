-- Manual fingerstick (capillary blood) glucose readings.
-- Independent of CGM data. Used when:
--   • CGM is in warm-up / failed / disconnected
--   • User wants to validate a suspicious CGM reading
--   • User has no CGM connected at all
--
-- Display rules (client):
--   • RollingChart renders fingerstick points as squares (white outline)
--     to distinguish from CGM circles.
--   • If a fingerstick reading exists ≤ 5 min in the past, it OVERRIDES
--     the latest CGM value as the "current glucose" everywhere
--     (dashboard hero number, engine glucose_before).
--
-- Idempotent (safe to re-run via scripts/apply-migration.mjs).

CREATE TABLE IF NOT EXISTS fingerstick_readings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  measured_at   timestamptz NOT NULL DEFAULT now(),
  value_mg_dl   numeric(5,1) NOT NULL CHECK (value_mg_dl >= 20 AND value_mg_dl <= 600),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fingerstick_readings_user_meas_idx
  ON fingerstick_readings (user_id, measured_at DESC);

ALTER TABLE fingerstick_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fingerstick_readings_select_own" ON fingerstick_readings;
CREATE POLICY "fingerstick_readings_select_own"
  ON fingerstick_readings FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "fingerstick_readings_insert_own" ON fingerstick_readings;
CREATE POLICY "fingerstick_readings_insert_own"
  ON fingerstick_readings FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "fingerstick_readings_update_own" ON fingerstick_readings;
CREATE POLICY "fingerstick_readings_update_own"
  ON fingerstick_readings FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "fingerstick_readings_delete_own" ON fingerstick_readings;
CREATE POLICY "fingerstick_readings_delete_own"
  ON fingerstick_readings FOR DELETE
  USING (auth.uid()::text = user_id);
