-- Dev Cockpit Phase 5 — Build Execution.
--
-- "Start Build" generates a structured build plan (plan only — NO code
-- generation; that's Phase 6). Adds storage for the build plan and the new
-- build-lifecycle statuses. Additive + idempotent — no existing data touched.

-- 1. Generated build plan (BuildExecutionPlan JSON). NULL until Start Build.
ALTER TABLE dev_cockpit_tasks
  ADD COLUMN IF NOT EXISTS build_plan jsonb;

-- 2. Widen the task status CHECK with the Phase-5 build lifecycle statuses.
--    Name-independent drop so a hand-recreated constraint is still replaced.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'dev_cockpit_tasks'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE dev_cockpit_tasks DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE dev_cockpit_tasks
  ADD CONSTRAINT dev_cockpit_tasks_status_check
  CHECK (status IN (
    'draft',
    'planning',
    'waiting_for_start',
    'waiting_for_input',
    'planning_build',
    'build_ready',
    'building',
    'build_failed',
    'build_complete',
    'preview_ready',
    'applied',
    'rejected',
    'cancelled',
    'archived',
    'backlog'
  ));

COMMENT ON COLUMN dev_cockpit_tasks.build_plan IS
  'Phase 5: generated BuildExecutionPlan JSON (scope, steps, included/excluded notes, affected_areas, risks, complexity). Plan only — no code generation yet.';
