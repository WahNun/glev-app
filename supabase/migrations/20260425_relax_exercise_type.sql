-- ============================================================
-- Exercise log evaluation system — widen exercise_type taxonomy
-- ============================================================
-- The legacy CHECK only allowed ('hypertrophy','cardio'). The new
-- evaluation UI lets the user pick from a richer set so the pattern
-- note panel can give type-specific guidance. We keep 'hypertrophy'
-- in the allow-list so any pre-existing rows remain valid (the form
-- offers 'strength' going forward; 'hypertrophy' is mapped to the
-- same display label by the UI layer).
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
    'run'
  ));
