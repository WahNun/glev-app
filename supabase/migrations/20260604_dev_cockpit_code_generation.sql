-- Dev Cockpit Phase 6 — Coding Agent (sandboxed code drafts).
--
-- "Generate Code" turns a build plan into a concrete CODE DRAFT (proposed files
-- + code blocks). PROPOSALS ONLY — nothing is written to disk, no commits, no
-- PRs, no deploys. Each generation is an immutable, versioned artifact.
--
-- Admin-only (RLS on, no policies), additive + idempotent.

-- 1. Latest code draft (denormalized) + metadata on the task.
ALTER TABLE dev_cockpit_tasks
  ADD COLUMN IF NOT EXISTS generated_code jsonb;
ALTER TABLE dev_cockpit_tasks
  ADD COLUMN IF NOT EXISTS code_generation_version integer;
ALTER TABLE dev_cockpit_tasks
  ADD COLUMN IF NOT EXISTS generated_at timestamptz;

-- 2. Widen the task status CHECK with the Phase-6 statuses.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
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
    'draft', 'planning', 'waiting_for_start', 'waiting_for_input',
    'planning_build', 'build_ready', 'building', 'build_failed', 'build_complete',
    'generating_code', 'code_ready', 'code_failed',
    'preview_ready', 'applied', 'rejected', 'cancelled', 'archived', 'backlog'
  ));

-- 3. Immutable per-draft code generation history.
CREATE TABLE IF NOT EXISTS dev_cockpit_code_generations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               uuid NOT NULL REFERENCES dev_cockpit_tasks (id) ON DELETE CASCADE,
  version               integer NOT NULL DEFAULT 1,
  status                text NOT NULL DEFAULT 'code_ready'
                        CHECK (status IN ('generating_code', 'code_ready', 'code_failed')),
  summary               text,
  files_to_create       jsonb NOT NULL DEFAULT '[]'::jsonb,
  files_to_modify       jsonb NOT NULL DEFAULT '[]'::jsonb,
  implementation_steps  jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_code_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_change_size text NOT NULL DEFAULT 'medium',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_cockpit_code_generations_task_idx
  ON dev_cockpit_code_generations (task_id, version DESC);

ALTER TABLE dev_cockpit_code_generations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION set_dev_cockpit_code_generations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dev_cockpit_code_generations_updated_at_tg ON dev_cockpit_code_generations;
CREATE TRIGGER dev_cockpit_code_generations_updated_at_tg
  BEFORE UPDATE ON dev_cockpit_code_generations
  FOR EACH ROW EXECUTE FUNCTION set_dev_cockpit_code_generations_updated_at();

COMMENT ON TABLE dev_cockpit_code_generations IS
  'Dev Cockpit Phase 6: immutable code-draft artifacts (proposals only — no writes/commits/PRs/deploys). Admin-only (RLS on, no policies).';
