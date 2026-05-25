-- Add `add_timeline_check` to the ai_pending_actions.kind CHECK constraint.
--
-- Task #691 added the `add_timeline_check` WRITE-tool to the route code
-- (app/api/ai/confirm-action/route.ts case "add_timeline_check") and to
-- lib/ai/glevTools.ts, but the original migration
-- (20260524_ai_pending_actions.sql) did not include it in the kind CHECK.
-- This migration closes that gap so the tool can actually write to the DB.
--
-- Pattern: drop the old constraint, recreate it with the extended value set.
-- Additive only — existing rows are unaffected.

ALTER TABLE public.ai_pending_actions
  DROP CONSTRAINT IF EXISTS ai_pending_actions_kind_check;

ALTER TABLE public.ai_pending_actions
  ADD CONSTRAINT ai_pending_actions_kind_check CHECK (kind IN (
    'log_meal_entry',
    'log_bolus_entry',
    'log_fingerstick',
    'add_appointment',
    'add_timeline_check'
  ));

NOTIFY pgrst, 'reload schema';
