CREATE TABLE IF NOT EXISTS public.replit_queue (
  id            BIGSERIAL PRIMARY KEY,
  asana_task_id TEXT        NOT NULL UNIQUE,
  task_name     TEXT        NOT NULL DEFAULT '',
  section_id    TEXT        NOT NULL DEFAULT '',
  project_id    TEXT        NOT NULL DEFAULT '',
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  processed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS replit_queue_status_idx
  ON public.replit_queue (status, received_at ASC);

ALTER TABLE public.replit_queue ENABLE ROW LEVEL SECURITY;
