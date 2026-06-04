-- Phase: Alcohol Dual-Emission — adds meal linkage + alcohol_g to influence_logs.
--
-- source_meal_id: FK to meals.id, set when an influence is auto-created alongside
--   a meal (e.g. alcohol detected in log_meal_entry items[]).  NULL for standalone
--   influences logged via log_influence_entry directly.  ON DELETE SET NULL so
--   deleting the parent meal does not orphan or cascade-delete the influence row.
--
-- alcohol_g: numeric gram amount stored directly on the row for query/eval
--   purposes without having to parse the `amount` text field.  NULL for non-alcohol
--   influences, or when the gram amount is unknown.
--
-- Idempotent (safe to re-run via IF NOT EXISTS / ALTER ... IF NOT EXISTS).

ALTER TABLE influence_logs
  ADD COLUMN IF NOT EXISTS source_meal_id UUID NULL
    REFERENCES meals(id) ON DELETE SET NULL;

ALTER TABLE influence_logs
  ADD COLUMN IF NOT EXISTS alcohol_g NUMERIC(6,1) NULL
    CHECK (alcohol_g IS NULL OR alcohol_g >= 0);

-- Index for the join used in Bolus-Calc and Outcome-Eval:
-- "given meal X, does it have an alcohol influence in the last 8h?"
CREATE INDEX IF NOT EXISTS influence_logs_source_meal_idx
  ON influence_logs (source_meal_id)
  WHERE source_meal_id IS NOT NULL;
