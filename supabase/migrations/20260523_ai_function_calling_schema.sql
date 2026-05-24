-- Phase 3 AI function-calling: schema additions for upcoming WRITE-tools
-- and timeline-checks (Tasks 2 & 3). Task 1 (READ-only tools) does NOT
-- use these columns/tables yet — they are added now so the migration
-- is a single atomic step instead of being split across follow-ups.
--
-- Notes on naming:
--   • The Phase 3 spec referenced an `entries` table, but the actual
--     Mahlzeit-Tabelle in this codebase is `meals`. We use `meals` here.
--   • All additions are additive and nullable; the existing app keeps
--     working unchanged. Safe to re-run (idempotent).
--
-- Columns on `meals`:
--   • bolus_taken_at — exact wall-clock moment the user said they took
--     the meal-bolus. Distinct from `created_at` (when the row was
--     inserted) and from `meal_time` (when the user started eating).
--     Needed so the AI can answer "wann hast du gespritzt?" precisely
--     without conflating insert-time with injection-time.
--   • pre_check_at — wall-clock moment of the pre-meal BZ-check.
--     Drives Task 3's timeline UI (post-bolus check chips).

ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS bolus_taken_at timestamptz,
  ADD COLUMN IF NOT EXISTS pre_check_at   timestamptz;

-- =============================================================
-- meal_timeline_checks
-- One row per post-bolus check the user planned for a meal. Used
-- by Task 3 (AI-orchestrated post-bolus reminders / confirmations).
--
-- check_type examples: 'post_bolus_1h', 'post_bolus_2h', 'pre_meal'.
-- planned_at vs confirmed_at: planned is when the AI scheduled it,
-- confirmed is when the user actually responded with a BZ value.
-- bg_at_check stores the BZ value captured at that moment (CGM or
-- manual fingerstick) so the engine can correlate later.
-- =============================================================
CREATE TABLE IF NOT EXISTS meal_timeline_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  meal_id       uuid REFERENCES meals(id) ON DELETE CASCADE,
  check_type    text NOT NULL,
  planned_at    timestamptz,
  confirmed_at  timestamptz,
  bg_at_check   numeric(5,1),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meal_timeline_checks_user_meal_idx
  ON meal_timeline_checks (user_id, meal_id, created_at DESC);

ALTER TABLE meal_timeline_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meal_timeline_checks_select_own" ON meal_timeline_checks;
CREATE POLICY "meal_timeline_checks_select_own"
  ON meal_timeline_checks FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "meal_timeline_checks_insert_own" ON meal_timeline_checks;
CREATE POLICY "meal_timeline_checks_insert_own"
  ON meal_timeline_checks FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "meal_timeline_checks_update_own" ON meal_timeline_checks;
CREATE POLICY "meal_timeline_checks_update_own"
  ON meal_timeline_checks FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "meal_timeline_checks_delete_own" ON meal_timeline_checks;
CREATE POLICY "meal_timeline_checks_delete_own"
  ON meal_timeline_checks FOR DELETE
  USING (auth.uid()::text = user_id);

-- Force PostgREST to reload its schema cache so the new columns/table
-- are visible to the API immediately (mirrors the pattern used in
-- 20260522_add_dia_minutes.sql and the other recent additive migrations).
NOTIFY pgrst, 'reload schema';
