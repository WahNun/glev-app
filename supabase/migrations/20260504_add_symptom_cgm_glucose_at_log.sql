-- Snapshot the live CGM glucose value at the moment a symptom is
-- logged so the symptom row carries its own glucose context. This
-- mirrors the `cgm_glucose_at_log` column already on `insulin_logs`
-- and `exercise_logs` and lets the entries / insights surfaces show
-- "Symptom X bei Glukose Y" without an extra historical lookup.
--
-- Notes:
--   * Numeric(5,1) matches the precision used elsewhere.
--   * Null for retroactive entries (occurred_at not "now") and for
--     legacy rows inserted before this column existed — the UI must
--     handle null gracefully.
--   * Idempotent (safe to re-run).

ALTER TABLE symptom_logs
  ADD COLUMN IF NOT EXISTS cgm_glucose_at_log numeric(5,1)
    CHECK (cgm_glucose_at_log IS NULL OR (cgm_glucose_at_log >= 20 AND cgm_glucose_at_log <= 600));

COMMENT ON COLUMN symptom_logs.cgm_glucose_at_log
  IS 'Live CGM reading captured at the moment the symptom was logged (mg/dL). Null when no CGM is connected, when the symptom is logged retroactively, or for legacy rows.';
