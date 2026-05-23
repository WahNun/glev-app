-- Add per-user basal action window column. Stores the user's typical
-- basal insulin duration in hours (e.g. Lantus 24, Toujeo 36, Tresiba 42,
-- Levemir 20). NULL = not set → IOBCard falls back to DEFAULT_BASAL_WINDOW_H
-- (24h) from lib/engine/constants.ts.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS basal_action_window_h smallint;

-- Sanity range: 12h (short-acting Detemir) … 72h (theoretical Tresiba ceiling).
ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS basal_action_window_h_range;
ALTER TABLE user_settings
  ADD CONSTRAINT basal_action_window_h_range
  CHECK (basal_action_window_h IS NULL OR (basal_action_window_h >= 12 AND basal_action_window_h <= 72));

COMMENT ON COLUMN user_settings.basal_action_window_h IS
  'User-configured basal insulin action window in hours (12-72). NULL = use type default (24h).';
