-- Extend ai_pending_actions.kind CHECK constraint with the four new
-- WRITE-tool kinds added by Task #1114 (AI Universal Logging).
--
-- New kinds:
--   log_exercise_entry  → exercise_logs table
--   log_symptom_entry   → symptom_logs table
--   log_influence_entry → influence_logs table
--   log_cycle_entry     → menstrual_logs table
--
-- Additive-only: existing rows are unaffected.
-- Pattern: drop old constraint, recreate with extended value set.

ALTER TABLE public.ai_pending_actions
  DROP CONSTRAINT IF EXISTS ai_pending_actions_kind_check;

ALTER TABLE public.ai_pending_actions
  ADD CONSTRAINT ai_pending_actions_kind_check CHECK (kind IN (
    'log_meal_entry',
    'log_bolus_entry',
    'log_basal_entry',
    'log_fingerstick',
    'add_appointment',
    'add_timeline_check',
    'update_setting',
    'log_exercise_entry',
    'log_symptom_entry',
    'log_influence_entry',
    'log_cycle_entry'
  ));

NOTIFY pgrst, 'reload schema';
