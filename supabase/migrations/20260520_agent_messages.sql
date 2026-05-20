-- Agent Message-Bus (Task: Telegram-Bot Phase 1)
-- Supabase-Tabelle als synchroner Message-Bus zwischen Agent und User.
-- Outbound: Agent schreibt eine Frage (direction = 'outbound').
-- Inbound:  Bot-Receiver (Phase 2) schreibt die Antwort (direction = 'inbound').
-- RLS: Nur die Service-Role darf lesen und schreiben (kein anon/authenticated-Zugriff).

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id          BIGSERIAL     PRIMARY KEY,
  task_id     TEXT          NOT NULL,
  direction   TEXT          NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  message     TEXT          NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_messages_task_created_idx
  ON public.agent_messages (task_id, created_at DESC);

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

-- Block all access for non-service-role users.
-- Service role bypasses RLS entirely, so no explicit service-role policy is needed.
CREATE POLICY "No public access"
  ON public.agent_messages
  FOR ALL
  USING (false)
  WITH CHECK (false);
