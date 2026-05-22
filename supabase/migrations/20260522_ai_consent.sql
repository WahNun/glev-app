-- AI consent flag. When true the user has acknowledged that the AI
-- helper is a UI prototype (no real backend) and agreed to the
-- coming-soon state. Defaults to false so existing users see the
-- "Coming soon" toast until they opt in via a future settings toggle.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS ai_consent boolean NOT NULL DEFAULT false;
