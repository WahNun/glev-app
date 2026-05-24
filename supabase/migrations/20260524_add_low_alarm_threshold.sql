-- Migration: low-glucose alarm settings on user_settings
-- Task #677: Low-glucose alarm push with custom sound
--
-- Adds two nullable columns so existing rows are untouched:
--   low_alarm_enabled       — master on/off switch (default TRUE)
--   low_alarm_threshold_mgdl — mg/dL value below which the alarm fires
--                              (default 70, range 40–90, matches
--                               clinical hypoglycaemia consensus and
--                               the SnapSlider bounds in Settings)
--
-- Idempotent (safe to re-run via pnpm db:migrate).

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS low_alarm_enabled          BOOLEAN  NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS low_alarm_threshold_mgdl   SMALLINT          DEFAULT 70
    CHECK (
      low_alarm_threshold_mgdl IS NULL OR
      (low_alarm_threshold_mgdl >= 40 AND low_alarm_threshold_mgdl <= 90)
    );

COMMENT ON COLUMN user_settings.low_alarm_enabled IS
  'Whether the low-glucose alarm is active. Default TRUE.';
COMMENT ON COLUMN user_settings.low_alarm_threshold_mgdl IS
  'CGM value (mg/dL) below which the alarm fires. Default 70, range 40-90.';
