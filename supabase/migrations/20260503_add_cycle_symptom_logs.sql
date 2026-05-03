-- Cycle (menstrual) and symptom logging tables.
-- Both are standalone event logs separate from meals/insulin/exercise.
-- Used by the Engine "Zyklus" + "Symptome" tabs and surfaced on the
-- entry log + insights cycle/symptom card. Idempotent (safe to re-run).

-- =============================================================
-- menstrual_logs
--   • A single row covers one bleeding/phase event.
--   • For period bleeding rows, start_date is required and end_date
--     is optional (null = still bleeding / single-day entry). In that
--     case flow_intensity is required.
--   • For phase-marker rows (ovulation / pms / other), start_date
--     equals the marker date, end_date is null, flow_intensity is
--     null, and phase_marker is set.
-- =============================================================
CREATE TABLE IF NOT EXISTS menstrual_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  start_date      date NOT NULL,
  end_date        date,
  flow_intensity  text CHECK (flow_intensity IN ('light','medium','heavy')),
  phase_marker    text CHECK (phase_marker IN ('ovulation','pms','other')),
  notes           text,
  CONSTRAINT menstrual_logs_kind_chk CHECK (
    flow_intensity IS NOT NULL OR phase_marker IS NOT NULL
  ),
  CONSTRAINT menstrual_logs_end_after_start_chk CHECK (
    end_date IS NULL OR end_date >= start_date
  )
);

CREATE INDEX IF NOT EXISTS menstrual_logs_user_start_idx
  ON menstrual_logs (user_id, start_date DESC);

ALTER TABLE menstrual_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menstrual_logs_select_own" ON menstrual_logs;
CREATE POLICY "menstrual_logs_select_own"
  ON menstrual_logs FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "menstrual_logs_insert_own" ON menstrual_logs;
CREATE POLICY "menstrual_logs_insert_own"
  ON menstrual_logs FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "menstrual_logs_update_own" ON menstrual_logs;
CREATE POLICY "menstrual_logs_update_own"
  ON menstrual_logs FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "menstrual_logs_delete_own" ON menstrual_logs;
CREATE POLICY "menstrual_logs_delete_own"
  ON menstrual_logs FOR DELETE
  USING (auth.uid()::text = user_id);

-- =============================================================
-- symptom_logs
--   • symptom_types is a JSONB array of stable enum tokens (see
--     lib/symptoms.ts SYMPTOM_TYPES). Stored as JSONB so we can later
--     filter / aggregate without a join table; that flexibility is
--     more important here than a strict FK because the curated symptom
--     vocabulary changes only with code releases.
--   • severity 1..5 covers the whole entry (per the spec — multiple
--     symptoms share one severity, keeping data entry frictionless).
-- =============================================================
CREATE TABLE IF NOT EXISTS symptom_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  symptom_types   jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity        smallint NOT NULL CHECK (severity BETWEEN 1 AND 5),
  notes           text,
  CONSTRAINT symptom_logs_types_nonempty_chk CHECK (
    jsonb_typeof(symptom_types) = 'array' AND jsonb_array_length(symptom_types) > 0
  )
);

CREATE INDEX IF NOT EXISTS symptom_logs_user_occurred_idx
  ON symptom_logs (user_id, occurred_at DESC);

ALTER TABLE symptom_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "symptom_logs_select_own" ON symptom_logs;
CREATE POLICY "symptom_logs_select_own"
  ON symptom_logs FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "symptom_logs_insert_own" ON symptom_logs;
CREATE POLICY "symptom_logs_insert_own"
  ON symptom_logs FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "symptom_logs_update_own" ON symptom_logs;
CREATE POLICY "symptom_logs_update_own"
  ON symptom_logs FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "symptom_logs_delete_own" ON symptom_logs;
CREATE POLICY "symptom_logs_delete_own"
  ON symptom_logs FOR DELETE
  USING (auth.uid()::text = user_id);
