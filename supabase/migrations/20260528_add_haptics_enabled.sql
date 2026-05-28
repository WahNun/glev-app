-- Add haptics_enabled column to user_settings.
-- Default true = vibrations on; user can turn off in Settings.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS haptics_enabled BOOLEAN NOT NULL DEFAULT true;
