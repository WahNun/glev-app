-- Push notification templates and hyper/elevated alarm support
-- Adds push_title + push_body columns to message_templates,
-- seed rows for push_hypo / push_hyper / push_elevated,
-- hyper/elevated alarm columns in user_settings,
-- and cooldown tables for hyper/elevated alarms.

-- 1. Extend message_templates with push columns
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS push_title TEXT,
  ADD COLUMN IF NOT EXISTS push_body  TEXT;

-- 2. Seed default push notification templates
-- {{value}} is replaced at runtime with the CGM value in mg/dL
INSERT INTO message_templates (key, label, push_title, push_body) VALUES
  ('push_hypo',
   'Push-Alarm: Hypo',
   '🔴 Hypo-Alarm · {{value}} mg/dL',
   'Dein BZ liegt bei {{value}} mg/dL — prüf dich jetzt.'),
  ('push_hyper',
   'Push-Alarm: Hyper',
   '🟠 Hyper-Alarm · {{value}} mg/dL',
   'Dein BZ liegt bei {{value}} mg/dL — prüf Korrektur und Mahlzeiten.'),
  ('push_elevated',
   'Push-Alarm: Erhöht',
   '🟡 Erhöhter BZ · {{value}} mg/dL',
   'Dein BZ liegt bei {{value}} mg/dL — behalte ihn im Auge.')
ON CONFLICT (key) DO NOTHING;

-- 3. Add hyper/elevated alarm columns to user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS high_alarm_enabled             BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS high_alarm_threshold_mgdl      SMALLINT NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS elevated_alarm_enabled         BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS elevated_alarm_threshold_mgdl  SMALLINT NOT NULL DEFAULT 140;

-- 4. Cooldown table for hyper alarm (mirrors hypo_push_cooldown)
CREATE TABLE IF NOT EXISTS hyper_push_cooldown (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Cooldown table for elevated alarm
CREATE TABLE IF NOT EXISTS elevated_push_cooldown (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
