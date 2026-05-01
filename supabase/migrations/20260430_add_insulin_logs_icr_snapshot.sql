-- Per-row ICR snapshot on insulin_logs.
--
-- Why this column exists
-- ----------------------
-- Without it, the CSV / PDF export code (lib/export.ts → insulinToCSV)
-- annotates every insulin row with the user's CURRENT
-- user_settings.icr_g_per_unit. For users who tune their ICR over
-- time, that means a single export silently labels old entries with
-- today's ratio — exactly the wrong thing for a clinician trying to
-- understand "what ratio was this dose calculated against?".
--
-- Storing the ratio at insert time on every new insulin_logs row
-- (written by lib/insulin.ts → insertInsulinLog) preserves the dosing
-- ratio for that specific entry. The export then prefers the per-row
-- snapshot when present and only falls back to the user's current
-- setting when the snapshot is NULL.
--
-- Schema notes
-- ------------
--   * Type matches user_settings.icr_g_per_unit (integer 1–100), so
--     copying values across is a 1:1 assignment with no rounding.
--   * Nullable: pre-existing rows have no captured snapshot; a
--     follow-up backfill migration (20260501_backfill_insulin_logs_icr_snapshot.sql)
--     fills in NULLs with each user's current setting on a best-effort
--     basis. New writes from lib/insulin.ts always set this column.
--   * Same CHECK bounds as user_settings.icr_g_per_unit so an out-of-
--     range value can never sneak into a snapshot column.
--
-- Idempotent (safe to re-run).

ALTER TABLE insulin_logs
  ADD COLUMN IF NOT EXISTS icr_g_per_ie_at_log integer
    CHECK (icr_g_per_ie_at_log BETWEEN 1 AND 100);

COMMENT ON COLUMN insulin_logs.icr_g_per_ie_at_log
  IS 'Snapshot of user_settings.icr_g_per_unit at the moment this insulin entry was logged (g of carb covered by 1 IE rapid insulin). NULL for pre-snapshot rows; the backfill migration (20260501_backfill_insulin_logs_icr_snapshot.sql) fills those with the user''s then-current setting on a best-effort basis. Export code prefers this per-row value over user_settings.icr_g_per_unit when present.';
