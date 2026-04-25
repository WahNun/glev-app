-- Insulin Logging (Bolus + Basal) — standalone insulin entries.
-- Separate from meals.insulin_units (which is mahlzeit-bound). Used for
-- basal doses, correction boluses between meals, or any insulin
-- documentation not tied to a meal. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS insulin_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  units       numeric(5,2) NOT NULL CHECK (units > 0 AND units <= 100),
  kind        text NOT NULL CHECK (kind IN ('bolus','basal','correction')),
  at          timestamptz NOT NULL,
  note        text,
  meal_id     uuid REFERENCES meals(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS insulin_logs_user_at_idx
  ON insulin_logs (user_id, at DESC);

ALTER TABLE insulin_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insulin_logs_select_own" ON insulin_logs;
CREATE POLICY "insulin_logs_select_own"
  ON insulin_logs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insulin_logs_insert_own" ON insulin_logs;
CREATE POLICY "insulin_logs_insert_own"
  ON insulin_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "insulin_logs_update_own" ON insulin_logs;
CREATE POLICY "insulin_logs_update_own"
  ON insulin_logs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "insulin_logs_delete_own" ON insulin_logs;
CREATE POLICY "insulin_logs_delete_own"
  ON insulin_logs FOR DELETE
  USING (auth.uid() = user_id);
