-- Shared rate-limit counter for POST /api/ai/chat.
-- Replaces the per-function-instance in-memory Map so the
-- 20-requests-per-minute cap survives serverless cold starts and
-- fan-out across instances.
CREATE TABLE IF NOT EXISTS public.ai_rate_limit_hits (
  id      BIGSERIAL    PRIMARY KEY,
  user_id UUID         NOT NULL,
  hit_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_rate_limit_hits_user_time_idx
  ON public.ai_rate_limit_hits (user_id, hit_at DESC);

ALTER TABLE public.ai_rate_limit_hits ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) reads/writes
-- this table. End users have no business touching it directly.
