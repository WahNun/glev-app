-- Add ICR / CF / target BG columns to user_settings so the unified
-- evaluator (lib/engine/evaluation.ts) and dose recommender can pull
-- the user's personal insulin parameters from the same row that
-- already holds their macro targets. Defaults match the legacy
-- DEFAULT_INSULIN_SETTINGS hard-coded fallback (ICR=15 g/u,
-- CF=50 mg/dL/u, target=110 mg/dL) so existing rows continue to work
-- without any data migration. Idempotent (safe to re-run).

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS icr_g_per_unit       integer
    CHECK (icr_g_per_unit       BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS cf_mgdl_per_unit     integer
    CHECK (cf_mgdl_per_unit     BETWEEN 1 AND 500),
  ADD COLUMN IF NOT EXISTS target_bg_mgdl       integer
    CHECK (target_bg_mgdl       BETWEEN 60 AND 200);

COMMENT ON COLUMN user_settings.icr_g_per_unit
  IS 'Insulin-to-carb ratio: grams of carb covered by 1u rapid insulin (default 15).';
COMMENT ON COLUMN user_settings.cf_mgdl_per_unit
  IS 'Correction factor: mg/dL drop per 1u rapid insulin (default 50).';
COMMENT ON COLUMN user_settings.target_bg_mgdl
  IS 'Target BG midpoint (mg/dL) — basis for bolus correction math (default 110).';
