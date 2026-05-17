-- Add the user's personal glucose target range (TIR band) to
-- user_settings. Prior to this migration the range only lived in
-- localStorage (`glev_settings.targetMin/targetMax`) which meant a
-- new browser / device snapped back to the 70/180 default and every
-- TIR card across the app silently used a different band than what
-- the user had configured. Persisting the range to the DB makes it
-- the cross-device source of truth and lets every card (Insights
-- TIR, Dashboard Today's Summary + Trend Breakdown, PDF report)
-- pull the same numbers.
--
-- Defaults match the clinical consensus (ATTD/ADA 70–180 mg/dL) so
-- existing rows continue to behave exactly as before. CHECK
-- constraints clamp inputs to physiologically plausible bounds
-- (40–250 covers the widest legitimate clinician-prescribed band).
-- Idempotent — safe to re-run.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS target_min_mgdl integer
    CHECK (target_min_mgdl BETWEEN 40 AND 250),
  ADD COLUMN IF NOT EXISTS target_max_mgdl integer
    CHECK (target_max_mgdl BETWEEN 40 AND 250);

-- Cross-column sanity: a row is only valid when both bounds are
-- either NULL (= "use default") or min < max with at least a 20
-- mg/dL spread (anything tighter is almost certainly a typo).
ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_target_range_ordering;
ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_target_range_ordering
  CHECK (
    (target_min_mgdl IS NULL AND target_max_mgdl IS NULL)
    OR (target_min_mgdl IS NOT NULL AND target_max_mgdl IS NOT NULL
        AND target_max_mgdl - target_min_mgdl >= 20)
  );

COMMENT ON COLUMN user_settings.target_min_mgdl
  IS 'Lower bound of the user''s personal TIR target band (mg/dL). NULL = use clinical default 70.';
COMMENT ON COLUMN user_settings.target_max_mgdl
  IS 'Upper bound of the user''s personal TIR target band (mg/dL). NULL = use clinical default 180.';
