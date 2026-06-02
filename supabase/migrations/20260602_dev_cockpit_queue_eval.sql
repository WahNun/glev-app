-- Dev Cockpit Phase 4 — Prompt Queue Evaluation.
--
-- Queue notes can now be evaluated by Mistral (impact / recommendation /
-- evaluation_text already exist from Phase 2). Phase 4 adds storage for the
-- structured extras and the "apply" markers, plus a new queue status for
-- "apply after build". Additive + idempotent — no existing data touched.

-- 1. Structured evaluation extras + current-build approval marker.
ALTER TABLE dev_cockpit_prompt_queue
  ADD COLUMN IF NOT EXISTS affected_areas jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dev_cockpit_prompt_queue
  ADD COLUMN IF NOT EXISTS risks jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dev_cockpit_prompt_queue
  ADD COLUMN IF NOT EXISTS approved_for_current_build boolean NOT NULL DEFAULT false;

-- 2. Widen the queue status CHECK to include 'after_build_pending'
--    (Apply After Build). Name-independent drop so a hand-recreated Phase-2
--    constraint with a different name is still replaced.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'dev_cockpit_prompt_queue'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE dev_cockpit_prompt_queue DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE dev_cockpit_prompt_queue
  ADD CONSTRAINT dev_cockpit_prompt_queue_status_check
  CHECK (status IN (
    'queued',
    'evaluated',
    'applied',
    'after_build_pending',
    'discarded',
    'converted_to_task'
  ));

COMMENT ON COLUMN dev_cockpit_prompt_queue.approved_for_current_build IS
  'Phase 4: queue note approved to be folded into the current build (a later build phase can pick these up). No build logic yet.';
