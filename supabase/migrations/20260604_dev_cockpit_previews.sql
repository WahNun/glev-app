-- Dev Cockpit Phase 7 — Preview Pipeline
--
-- New table dev_cockpit_previews: immutable per-preview history.
-- New columns on dev_cockpit_tasks: Vercel deployment sub-state + refs.
--
-- Idempotent (safe to re-run).

-- ── New columns on dev_cockpit_tasks ─────────────────────────────────────────
-- preview_url already existed (reserved in Phase 1 migration).
-- These three are new for Phase 7.

ALTER TABLE dev_cockpit_tasks
  ADD COLUMN IF NOT EXISTS preview_status     text,        -- queued|building|ready|failed (Vercel)
  ADD COLUMN IF NOT EXISTS preview_commit_sha text,
  ADD COLUMN IF NOT EXISTS preview_created_at timestamptz;

-- ── dev_cockpit_previews ──────────────────────────────────────────────────────
-- Immutable history: one row per preview attempt.
-- Multiple previews per task are supported (Preview #1, #2, …).

CREATE TABLE IF NOT EXISTS dev_cockpit_previews (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id              uuid        NOT NULL REFERENCES dev_cockpit_tasks(id) ON DELETE CASCADE,
  -- Which frozen build + code draft this preview is based on.
  build_id             uuid        REFERENCES dev_cockpit_builds(id),
  code_generation_id   uuid        REFERENCES dev_cockpit_code_generations(id),
  -- 1-based counter within this task (Preview #1, #2, …).
  preview_version      integer     NOT NULL DEFAULT 1,
  -- Git branch created for this preview (feature/task-{taskId}-build-{v}).
  branch_name          text        NOT NULL,
  commit_sha           text,
  commit_message       text,
  -- Vercel deployment state (mirrors Vercel API + GitHub Deployments status).
  deployment_status    text        NOT NULL DEFAULT 'queued'
                                   CHECK (deployment_status IN ('queued','building','ready','failed')),
  -- GitHub Deployment id used for polling.
  github_deployment_id bigint,
  -- Final Vercel preview URL (set when deployment_status = 'ready').
  preview_url          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_cockpit_previews_task_idx
  ON dev_cockpit_previews(task_id, created_at DESC);

-- RLS enabled (admin-only via service role — no anon/authenticated policies).
ALTER TABLE dev_cockpit_previews ENABLE ROW LEVEL SECURITY;
