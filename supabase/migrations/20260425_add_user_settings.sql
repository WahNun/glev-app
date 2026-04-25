-- Per-user preferences. Currently holds daily macro targets used by the
-- dashboard "Today's Macros" card; will absorb the remaining localStorage-
-- based settings (glucose range, ICR, CF, notification flags) in a follow-
-- up. One row per user keyed on auth.uid()::text to match the convention
-- used by insulin_logs / exercise_logs / meals. Idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS user_settings (
  user_id          text PRIMARY KEY,
  target_carbs_g   integer NOT NULL DEFAULT 250 CHECK (target_carbs_g   BETWEEN 0 AND 2000),
  target_protein_g integer NOT NULL DEFAULT 120 CHECK (target_protein_g BETWEEN 0 AND 2000),
  target_fat_g     integer NOT NULL DEFAULT 80  CHECK (target_fat_g     BETWEEN 0 AND 2000),
  target_fiber_g   integer NOT NULL DEFAULT 30  CHECK (target_fiber_g   BETWEEN 0 AND 200),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_settings_select_own" ON user_settings;
CREATE POLICY "user_settings_select_own"
  ON user_settings FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "user_settings_insert_own" ON user_settings;
CREATE POLICY "user_settings_insert_own"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "user_settings_update_own" ON user_settings;
CREATE POLICY "user_settings_update_own"
  ON user_settings FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Auto-bump updated_at on every change so the row's "last changed" is
-- queryable without callers having to set it explicitly.
CREATE OR REPLACE FUNCTION set_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_settings_updated_at_tg ON user_settings;
CREATE TRIGGER user_settings_updated_at_tg
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION set_user_settings_updated_at();
