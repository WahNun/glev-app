-- Influence (Einflussfaktoren) event log.
-- Standalone log for things that affect glucose / insulin sensitivity
-- but don't fit meal/insulin/exercise/cycle/symptom buckets — alcohol,
-- cannabis, medications, "other" influences. Pure documentation only:
-- the Engine does NOT read these rows and does NOT alter dosage from
-- them. Idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS influence_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  influence_type      text NOT NULL CHECK (influence_type IN ('alcohol','cannabis','medication','other')),
  details             text,
  amount              text,
  cgm_glucose_at_log  numeric(5,1) CHECK (
    cgm_glucose_at_log IS NULL
    OR (cgm_glucose_at_log >= 20 AND cgm_glucose_at_log <= 600)
  ),
  notes               text
);

CREATE INDEX IF NOT EXISTS influence_logs_user_occurred_idx
  ON influence_logs (user_id, occurred_at DESC);

ALTER TABLE influence_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "influence_logs_select_own" ON influence_logs;
CREATE POLICY "influence_logs_select_own"
  ON influence_logs FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "influence_logs_insert_own" ON influence_logs;
CREATE POLICY "influence_logs_insert_own"
  ON influence_logs FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "influence_logs_update_own" ON influence_logs;
CREATE POLICY "influence_logs_update_own"
  ON influence_logs FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "influence_logs_delete_own" ON influence_logs;
CREATE POLICY "influence_logs_delete_own"
  ON influence_logs FOR DELETE
  USING (auth.uid()::text = user_id);
