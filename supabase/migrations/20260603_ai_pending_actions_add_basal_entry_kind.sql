-- Add `log_basal_entry` and `update_setting` to the ai_pending_actions.kind CHECK constraint.
--
-- `log_basal_entry` is a new WRITE-tool that stores long-acting (basal) insulin doses.
-- `update_setting` was wired in the route code but never added to the constraint.
-- Both additions are purely additive — existing rows are unaffected.
--
-- Pattern: drop the old constraint, recreate it with the extended value set.

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
    'update_setting'
  ));

NOTIFY pgrst, 'reload schema';
