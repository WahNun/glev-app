-- Apple Health workout sync — extends exercise_logs so HKWorkoutType
-- entries can be pushed from the iOS shell alongside manual log-tab
-- entries. Follows the same pattern as apple_health_readings (Migration
-- 20260430): the device is the only writer for source='apple_health'
-- rows, deduplicated by HealthKit's per-sample UUID.
--
-- Design decisions:
--
--   * `source` text instead of enum — matches profiles.cgm_source style
--     (Migration 20260430) so future sources (Garmin Connect direct
--     etc.) are a one-line CHECK update instead of an enum migration.
--   * `external_id` is HealthKit's HKWorkout.uuid (text). Nullable so
--     existing manual rows stay valid. The partial unique index makes
--     re-pushing the same workout a no-op without forcing manual rows
--     to invent a fake UUID.
--   * `avg_heart_rate` / `max_heart_rate` are smallint (0–250 bpm
--     covers every realistic value, saves 2 bytes per row vs int).
--     Nullable because (a) manual rows don't have it, (b) some Apple
--     Health workouts come from third-party apps that don't write HR
--     samples (e.g. Strava sometimes).
--   * `started_at` / `ended_at` — for manual logs we only know
--     `created_at` (= time the user tapped Save). For Apple Health
--     workouts we know the real workout window, which the Engine needs
--     for the "exercise within 4h" safety hook to be accurate.
--     Nullable so old rows stay valid.
--   * UI policy (already agreed): notes + intensity remain editable on
--     synced rows; type/duration/HR/time-window are locked. Enforcement
--     happens in the API layer (route handler) and the UI form — DB
--     stays permissive so a future "edit synced workouts" toggle is a
--     pure product decision, not a schema migration.
--
-- Idempotent (safe to re-run via npm run db:migrate).

-- 1. New columns ----------------------------------------------------------
ALTER TABLE exercise_logs
  ADD COLUMN IF NOT EXISTS source           text     NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id      text,
  ADD COLUMN IF NOT EXISTS avg_heart_rate   smallint,
  ADD COLUMN IF NOT EXISTS max_heart_rate   smallint,
  ADD COLUMN IF NOT EXISTS started_at       timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at         timestamptz;

-- 2. CHECK constraints — wrapped in DO blocks so re-runs are no-ops -------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE  table_name = 'exercise_logs'
      AND  constraint_name = 'exercise_logs_source_check'
  ) THEN
    ALTER TABLE exercise_logs
      ADD CONSTRAINT exercise_logs_source_check
      CHECK (source IN ('manual', 'apple_health'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE  table_name = 'exercise_logs'
      AND  constraint_name = 'exercise_logs_avg_hr_check'
  ) THEN
    ALTER TABLE exercise_logs
      ADD CONSTRAINT exercise_logs_avg_hr_check
      CHECK (avg_heart_rate IS NULL OR (avg_heart_rate > 0 AND avg_heart_rate <= 250));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE  table_name = 'exercise_logs'
      AND  constraint_name = 'exercise_logs_max_hr_check'
  ) THEN
    ALTER TABLE exercise_logs
      ADD CONSTRAINT exercise_logs_max_hr_check
      CHECK (max_heart_rate IS NULL OR (max_heart_rate > 0 AND max_heart_rate <= 250));
  END IF;

  -- ended_at must be > started_at when both present (no zero-second workouts)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE  table_name = 'exercise_logs'
      AND  constraint_name = 'exercise_logs_workout_window_check'
  ) THEN
    ALTER TABLE exercise_logs
      ADD CONSTRAINT exercise_logs_workout_window_check
      CHECK (started_at IS NULL OR ended_at IS NULL OR ended_at > started_at);
  END IF;

  -- Synced rows MUST have an external_id (otherwise we cannot dedupe)
  -- AND a real workout window (started_at + ended_at — the Engine's
  -- "exercise within 4h" hook is meaningless without it).
  -- Manual rows MUST NOT have external_id (avoid client-side abuse).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE  table_name = 'exercise_logs'
      AND  constraint_name = 'exercise_logs_external_id_source_check'
  ) THEN
    ALTER TABLE exercise_logs
      ADD CONSTRAINT exercise_logs_external_id_source_check
      CHECK (
        (source = 'manual'
           AND external_id IS NULL)
        OR
        (source = 'apple_health'
           AND external_id IS NOT NULL
           AND started_at  IS NOT NULL
           AND ended_at    IS NOT NULL)
      );
  END IF;
END $$;

-- 3. Idempotent re-upload index ------------------------------------------
-- Plain UNIQUE on (user_id, external_id) — not partial. Postgres
-- treats NULLs in unique indexes as distinct by default, so any number
-- of manual rows (external_id=NULL) coexist without collision, while
-- two synced rows with the same external_id for one user are blocked.
-- This shape plays nicely with both raw `ON CONFLICT (user_id,
-- external_id)` and Supabase PostgREST `upsert(..., onConflict:
-- 'user_id,external_id')` — partial indexes require matching WHERE
-- predicates in the conflict target, which PostgREST does not emit.
--
-- DROP first to clean up the partial index from earlier dev applies
-- of this same migration before it was hardened.
DROP INDEX IF EXISTS exercise_logs_user_external_id_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS exercise_logs_user_external_id_uidx
  ON exercise_logs (user_id, external_id);

-- 4. Hot-path index for Engine "recent workouts" lookup ------------------
-- The Engine safety hook asks "any workout in the last 4h?" — for synced
-- rows started_at is the source of truth, for manual rows created_at
-- still applies. COALESCE keeps a single index serving both queries.
CREATE INDEX IF NOT EXISTS exercise_logs_user_effective_time_idx
  ON exercise_logs (user_id, (COALESCE(started_at, created_at)) DESC);
