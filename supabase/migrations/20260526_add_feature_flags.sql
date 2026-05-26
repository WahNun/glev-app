-- Feature-flags column on user_settings.
-- Default '{}' = alle Features aus. Per User oder global aktivierbar via SQL.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN user_settings.feature_flags IS
  'Key/value map für per-User Feature-Flags. z.B. {"ai_voice": true}';
