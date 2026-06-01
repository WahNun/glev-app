-- Dev Cockpit — Phase 2 persistence layer (Task: Dev Cockpit Phase 2).
--
-- Phase 1 shipped a pure client-side mock UI under /glev-ops/dev-cockpit.
-- Phase 2 replaces the local mock state with real persistent storage so
-- tasks, chat messages, prompt-queue notes and (placeholder) attachment
-- metadata survive reloads. NO AI calls, NO GitHub branches, NO Vercel
-- previews, NO real file uploads are wired up here — those land in later
-- phases. This migration only creates the tables those features will
-- eventually populate.
--
-- Security model:
--   These are ADMIN-ONLY tables. Unlike the per-user app tables (meals,
--   insulin_logs, …) there is no `auth.uid()` owner — every Dev Cockpit
--   row belongs to the operator, not an end user. We therefore ENABLE
--   row level security but define NO policies, which means the anon and
--   authenticated roles can read/write nothing. The only access path is
--   the service-role client (`getSupabaseAdmin()`), which bypasses RLS,
--   and every server action behind it is already gated by
--   `isAdminAuthed()`. This mirrors the existing admin tooling and keeps
--   the data fully off-limits to the public app.
--
-- Idempotent (safe to re-run via scripts/apply-migration.mjs). No
-- destructive statements — only CREATE … IF NOT EXISTS and guarded
-- DROP POLICY / DROP TRIGGER for re-runs.

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger function (one function, reused by every table
-- below that carries an updated_at column). CREATE OR REPLACE is safe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_dev_cockpit_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- dev_cockpit_tasks — the central unit of work in the cockpit.
--   • status drives which "view" (Active / Backlog / Archived / …) a task
--     shows up in. The CHECK constraint enumerates every Phase-2 status so
--     a typo in application code fails loudly at write time.
--   • branch_name / preview_url / plan_text / diff_summary / changed_files
--     are reserved for later phases (GitHub, Vercel, AI plan/diff). They
--     stay NULL in Phase 2 — defined now so the schema is stable.
--   • changed_files is jsonb (an array of {path, …} objects later); defaults
--     to an empty array so reads never have to null-check.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dev_cockpit_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL DEFAULT 'Neue Task',
  prompt        text,
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN (
                  'draft', 'planning', 'waiting_for_start', 'building',
                  'preview_ready', 'applied', 'rejected', 'cancelled',
                  'archived', 'backlog'
                )),
  branch_name   text,
  preview_url   text,
  plan_text     text,
  diff_summary  text,
  changed_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_cockpit_tasks_status_idx
  ON dev_cockpit_tasks (status, created_at DESC);

ALTER TABLE dev_cockpit_tasks ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS dev_cockpit_tasks_updated_at_tg ON dev_cockpit_tasks;
CREATE TRIGGER dev_cockpit_tasks_updated_at_tg
  BEFORE UPDATE ON dev_cockpit_tasks
  FOR EACH ROW EXECUTE FUNCTION set_dev_cockpit_updated_at();

COMMENT ON TABLE dev_cockpit_tasks IS
  'Dev Cockpit Phase 2: persistent dev tasks. Admin-only (RLS on, no policies — service role access only).';

-- ---------------------------------------------------------------------------
-- dev_cockpit_messages — chat / task message history per task.
--   role ∈ {user, assistant, system}. In Phase 2 only `user` (the initial
--   prompt) is written; `assistant`/`system` arrive once AI calls exist.
--   ON DELETE CASCADE so deleting a task (if ever exposed) cleans up its
--   message trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dev_cockpit_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES dev_cockpit_tasks (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_cockpit_messages_task_idx
  ON dev_cockpit_messages (task_id, created_at ASC);

ALTER TABLE dev_cockpit_messages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE dev_cockpit_messages IS
  'Dev Cockpit Phase 2: per-task chat/message history. Admin-only (RLS on, no policies).';

-- ---------------------------------------------------------------------------
-- dev_cockpit_attachments — METADATA ONLY in Phase 2.
--   No real upload pipeline is built yet. This table just reserves the
--   shape so the UI can list placeholder attachment rows and later phases
--   can fill in `file_url_or_storage_path` with a real storage key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dev_cockpit_attachments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                 uuid NOT NULL REFERENCES dev_cockpit_tasks (id) ON DELETE CASCADE,
  file_name               text NOT NULL,
  file_type               text,
  file_url_or_storage_path text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_cockpit_attachments_task_idx
  ON dev_cockpit_attachments (task_id, created_at DESC);

ALTER TABLE dev_cockpit_attachments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE dev_cockpit_attachments IS
  'Dev Cockpit Phase 2: attachment metadata placeholders (no real upload yet). Admin-only (RLS on, no policies).';

-- ---------------------------------------------------------------------------
-- dev_cockpit_prompt_queue — per-task queue of follow-up prompt notes.
--   In Phase 2 a note is just stored (status 'queued') and listed. The
--   evaluation fields (impact_level, recommendation, evaluation_text) are
--   reserved for the Phase 4 "Evaluate Queue" AI pass and stay NULL until
--   then. CHECK constraints enumerate the allowed enum values.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dev_cockpit_prompt_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES dev_cockpit_tasks (id) ON DELETE CASCADE,
  content         text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN (
                    'queued', 'evaluated', 'applied', 'discarded',
                    'converted_to_task'
                  )),
  impact_level    text CHECK (impact_level IN ('low', 'medium', 'high')),
  recommendation  text CHECK (recommendation IN (
                    'current_build', 'after_build', 'separate_task', 'discard'
                  )),
  evaluation_text text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_cockpit_prompt_queue_task_idx
  ON dev_cockpit_prompt_queue (task_id, created_at DESC);

ALTER TABLE dev_cockpit_prompt_queue ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS dev_cockpit_prompt_queue_updated_at_tg ON dev_cockpit_prompt_queue;
CREATE TRIGGER dev_cockpit_prompt_queue_updated_at_tg
  BEFORE UPDATE ON dev_cockpit_prompt_queue
  FOR EACH ROW EXECUTE FUNCTION set_dev_cockpit_updated_at();

COMMENT ON TABLE dev_cockpit_prompt_queue IS
  'Dev Cockpit Phase 2: per-task prompt-queue notes. Evaluation fields fill in Phase 4. Admin-only (RLS on, no policies).';
