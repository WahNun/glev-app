-- Persist the adaptive engine's accepted adjustments alongside the
-- user's insulin parameters. Each row in the JSONB array is an
-- AdjustmentRecord (lib/engine/adjustment.ts):
--   { at: ISO timestamp, field: "icr"|"correctionFactor",
--     from: number, to: number, reason: string }
--
-- Lives on user_settings (next to icr_g_per_unit / cf_mgdl_per_unit)
-- so applying an engine suggestion is a single read-modify-write
-- against one row. Default '[]' keeps existing rows + new sign-ups
-- working without a backfill.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS adjustment_history jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN user_settings.adjustment_history
  IS 'Adaptive engine adjustments the user accepted. Append-only audit trail of {at, field, from, to, reason} entries.';
