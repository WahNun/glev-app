-- Per-row ICR snapshot for insulin_logs.
--
-- The user's `icr_g_per_unit` (in user_settings) is a single,
-- mutable value. When a doctor reviews the historic log months later
-- the ratio at the time of dose is the only fair context for "U vs
-- carbs" sanity-checking. Snapshot it on the row at insert time and
-- expose it in the in-app entries list, the CSV / PDF exports, and
-- on bolus expand views.
--
-- Idempotent (safe to re-run). Numeric(5,1) mirrors the precision of
-- the related `cgm_glucose_at_log` column. The CHECK keeps obviously
-- bad values out (settings UI clamps to 1..100 g/IE).

ALTER TABLE insulin_logs
  ADD COLUMN IF NOT EXISTS icr_g_per_ie_at_log numeric(5,1)
    CHECK (icr_g_per_ie_at_log IS NULL OR (icr_g_per_ie_at_log > 0 AND icr_g_per_ie_at_log <= 100));

COMMENT ON COLUMN insulin_logs.icr_g_per_ie_at_log
  IS 'Snapshot of user_settings.icr_g_per_unit (g carb / IE) at the moment the dose was logged. Null for legacy rows and for entries logged before the user configured an ICR. Only meaningful for bolus entries.';
