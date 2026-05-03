-- ============================================================
-- Exercise log evaluation system — widen exercise_type taxonomy
-- to include team / racquet sports (Task #203).
-- ============================================================
-- The previous widening (20260425_relax_exercise_type.sql) added
-- cardio/hiit/yoga/cycling/run on top of the legacy
-- ('hypertrophy','cardio') allow-list. This migration supersedes
-- that constraint so a single forward migration brings any database
-- (dev or prod) to the full ten-value taxonomy plus the legacy
-- 'hypertrophy' alias.
--
-- Symptom this fixes:
--   POST /api/exercise → 23514 new row violates check constraint
--   "exercise_logs_exercise_type_check"
--   …whenever the form submitted any value beyond the original
--   ('hypertrophy','cardio') pair, because the prior widening hadn't
--   been applied to the live database.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE exercise_logs
  DROP CONSTRAINT IF EXISTS exercise_logs_exercise_type_check;

ALTER TABLE exercise_logs
  ADD CONSTRAINT exercise_logs_exercise_type_check
  CHECK (exercise_type IN (
    'hypertrophy',  -- legacy alias, displayed as "strength"
    'strength',
    'cardio',
    'hiit',
    'yoga',
    'cycling',
    'run',
    -- Team / racquet sports — intermittent aerobic activity.
    'football',
    'tennis',
    'volleyball',
    'basketball'
  ));
