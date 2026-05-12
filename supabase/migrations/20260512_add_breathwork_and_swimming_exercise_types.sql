-- ============================================================
-- Exercise log evaluation system — widen exercise_type taxonomy
-- to include swimming, body-temperature events (hot/cold shower)
-- and breathwork. Lucas request 2026-05-12.
-- ============================================================
-- The previous widening (20260503_add_team_sport_exercise_types.sql)
-- locked the constraint to:
--   hypertrophy, strength, cardio, hiit, yoga, cycling, run,
--   football, tennis, volleyball, basketball
--
-- The form (components/EngineLogTab.tsx) and ExerciseType union
-- (lib/exercise.ts) had since added "swimming", "hot_shower",
-- "cold_shower" without a matching DB migration — meaning POST
-- /api/exercise would 23514 in production for any of those values.
-- This migration brings the live constraint back in sync AND adds
-- the new "breathwork" bucket in the same forward step so dev and
-- prod databases land at the same allow-list.
--
-- Symptom this fixes:
--   POST /api/exercise → 23514 new row violates check constraint
--   "exercise_logs_exercise_type_check"
--   …whenever the form submits swimming / hot_shower / cold_shower /
--   breathwork on a database that still carries the 0503 constraint.
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
    'swimming',
    -- Team / racquet sports — intermittent aerobic activity.
    'football',
    'tennis',
    'volleyball',
    'basketball',
    -- Breath / temperature events — not strictly "sport" but they
    -- affect glucose dynamics enough to warrant logging next to it.
    'breathwork',
    'hot_shower',
    'cold_shower'
  ));
