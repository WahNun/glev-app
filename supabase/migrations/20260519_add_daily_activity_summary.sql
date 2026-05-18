-- Apple Health daily activity (Task #183) — per-day step / active-minute
-- aggregates pushed from the iOS HealthKit shell.
--
-- Why this is a separate table from exercise_logs:
--   `exercise_logs` stores discrete workout events ("30 min run at 18:05").
--   Steps are a continuous daily time series ("8 432 steps on 2026-05-17").
--   Mixing the two would either double-count active periods or break the
--   per-workout outcome math. Keep them split; the engine can join on
--   user_id + date when it wants a "context" view.
--
-- The exercise_logs.source / external_id fundament for FUTURE HKWorkout
-- imports already shipped in 20260518_extend_exercise_logs_apple_health.sql,
-- so this migration only adds the new table.
--
-- Idempotent (safe to re-run via npm run db:migrate).

CREATE TABLE IF NOT EXISTS daily_activity_summary (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Calendar day in the USER's local timezone — the iOS shell computes
  -- "today" against the device clock and POSTs that date. Storing as
  -- DATE (not timestamptz) keeps the upsert key tz-stable.
  date            date        NOT NULL,
  -- HealthKit `stepCount` sum for the day. Capped at 250 000 below
  -- (~125 km of walking — well past any realistic value, catches
  -- accidental unit-confusion bugs without rejecting ultra-marathoners).
  steps           integer     NOT NULL DEFAULT 0,
  -- Optional `appleExerciseTime` minutes. Nullable so older syncs that
  -- only sent steps still upsert cleanly.
  active_minutes  integer,
  -- Always 'apple_health' today. Kept as text (not enum) so future
  -- sources (Google Fit, Garmin direct) are a one-line CHECK update.
  source          text        NOT NULL DEFAULT 'apple_health',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE  table_name = 'daily_activity_summary'
      AND  constraint_name = 'daily_activity_summary_source_check'
  ) THEN
    ALTER TABLE daily_activity_summary
      ADD CONSTRAINT daily_activity_summary_source_check
      CHECK (source IN ('apple_health'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE  table_name = 'daily_activity_summary'
      AND  constraint_name = 'daily_activity_summary_steps_check'
  ) THEN
    ALTER TABLE daily_activity_summary
      ADD CONSTRAINT daily_activity_summary_steps_check
      CHECK (steps >= 0 AND steps <= 250000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE  table_name = 'daily_activity_summary'
      AND  constraint_name = 'daily_activity_summary_active_minutes_check'
  ) THEN
    ALTER TABLE daily_activity_summary
      ADD CONSTRAINT daily_activity_summary_active_minutes_check
      CHECK (active_minutes IS NULL OR (active_minutes >= 0 AND active_minutes <= 1440));
  END IF;
END $$;

-- Idempotent per-day/source upsert key. A user can have one row per
-- date per source — re-syncing the same day overwrites, never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS daily_activity_summary_user_date_source_uidx
  ON daily_activity_summary (user_id, date, source);

-- Hot-path index for "give me the last N days" reads (today's steps
-- card, engine context lookup).
CREATE INDEX IF NOT EXISTS daily_activity_summary_user_date_idx
  ON daily_activity_summary (user_id, date DESC);

-- RLS — service-role ingest bypasses this; user-side reads via PostgREST
-- (the Insights card) get filtered to their own rows.
ALTER TABLE daily_activity_summary ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  tablename = 'daily_activity_summary'
      AND  policyname = 'daily_activity_summary_select_self'
  ) THEN
    CREATE POLICY daily_activity_summary_select_self
      ON daily_activity_summary
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  tablename = 'daily_activity_summary'
      AND  policyname = 'daily_activity_summary_delete_self'
  ) THEN
    CREATE POLICY daily_activity_summary_delete_self
      ON daily_activity_summary
      FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
