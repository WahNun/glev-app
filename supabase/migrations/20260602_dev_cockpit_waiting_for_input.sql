-- Dev Cockpit Phase 3 — allow the `waiting_for_input` task status.
--
-- Phase 2 added `waiting_for_input` to the TypeScript types + sidebar
-- visualisation but deliberately NOT to the DB, because nothing wrote it yet.
-- Phase 3 connects Analyze Task to Mistral: when the analysis returns open
-- questions (`ready_to_build = false`), the task is set to `waiting_for_input`.
-- So the CHECK constraint on dev_cockpit_tasks.status must now accept it.
--
-- This only widens the allowed set — every previously valid value stays valid,
-- no existing row can violate the new constraint. Non-destructive + idempotent
-- (drop-if-exists then re-add with the full enum).

-- Drop ANY existing CHECK constraint on the status column, regardless of its
-- name. The Phase-2 migration was hand-recreated on Replit, so we can't assume
-- the auto-generated name `dev_cockpit_tasks_status_check` — a name mismatch
-- would otherwise leave the old (narrower) CHECK in force and reject
-- `waiting_for_input`. This finds every CHECK on the table that references
-- `status` and drops it before re-adding the canonical one.
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
    'building',
    'preview_ready',
    'applied',
    'rejected',
    'cancelled',
    'archived',
    'backlog'
  ));

COMMENT ON CONSTRAINT dev_cockpit_tasks_status_check ON dev_cockpit_tasks IS
  'Dev Cockpit task lifecycle statuses. waiting_for_input added in Phase 3 (Mistral analysis with open questions).';
