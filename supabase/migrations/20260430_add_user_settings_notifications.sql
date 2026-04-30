-- Add notification preference columns to user_settings so the smart-
-- notifications system (cron + push) and the in-app Settings sheet share
-- a single source of truth for what each user wants delivered and when.
-- Stored on user_settings (not profiles) to keep it next to the other
-- preference rows the same page already writes (macros, insulin params).
-- Idempotent (safe to re-run).

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS notif_critical_alerts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_smart_reminders boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notif_quiet_start     time    NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS notif_quiet_end       time    NOT NULL DEFAULT '07:00';

COMMENT ON COLUMN user_settings.notif_critical_alerts
  IS 'Send hypo/hyper push alerts when CGM is in critical range. Default on.';
COMMENT ON COLUMN user_settings.notif_smart_reminders
  IS 'Send habit-based meal-time reminders learned from meal_logs. Default off; UI gates this on enough history (Phase 2).';
COMMENT ON COLUMN user_settings.notif_quiet_start
  IS 'Local time of day after which non-critical notifications are suppressed (default 22:00). Wraps over midnight when start > end.';
COMMENT ON COLUMN user_settings.notif_quiet_end
  IS 'Local time of day before which non-critical notifications are suppressed (default 07:00).';
