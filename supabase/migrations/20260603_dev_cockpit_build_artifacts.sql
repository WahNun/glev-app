-- Dev Cockpit Phase 5.1 — Build artifacts (versioned, frozen build records).
--
-- Each "Start Build" produces an immutable build record so a task can have a
-- history of builds (#1, #2, #3) and Phase 6 can reliably build on a stable
-- artifact. The frozen note snapshots are captured at generation time and never
-- re-read from the live queue. PLAN ONLY — no code execution.
--
-- Admin-only (RLS on, no policies — service-role access only), additive +
-- idempotent. The denormalized "latest build" still lives in
-- dev_cockpit_tasks.build_plan (added in 20260603_dev_cockpit_build_execution).

CREATE TABLE IF NOT EXISTS dev_cockpit_builds (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                  uuid NOT NULL REFERENCES dev_cockpit_tasks (id) ON DELETE CASCADE,
  version                  integer NOT NULL DEFAULT 1,
  status                   text NOT NULL DEFAULT 'build_ready'
                           CHECK (status IN (
                             'planning_build', 'build_ready', 'building',
                             'build_failed', 'build_complete'
                           )),
  scope                    text,
  steps                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  included_notes_snapshot  jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_notes_snapshot  jsonb NOT NULL DEFAULT '[]'::jsonb,
  affected_areas           jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  complexity               text NOT NULL DEFAULT 'medium',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_cockpit_builds_task_idx
  ON dev_cockpit_builds (task_id, version DESC);

ALTER TABLE dev_cockpit_builds ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION set_dev_cockpit_builds_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dev_cockpit_builds_updated_at_tg ON dev_cockpit_builds;
CREATE TRIGGER dev_cockpit_builds_updated_at_tg
  BEFORE UPDATE ON dev_cockpit_builds
  FOR EACH ROW EXECUTE FUNCTION set_dev_cockpit_builds_updated_at();

COMMENT ON TABLE dev_cockpit_builds IS
  'Dev Cockpit Phase 5.1: immutable per-build artifacts (frozen snapshots) for build history. Admin-only (RLS on, no policies).';
