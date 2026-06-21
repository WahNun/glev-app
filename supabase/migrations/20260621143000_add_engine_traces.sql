CREATE TABLE IF NOT EXISTS public.engine_traces (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid,
  trace_type       text         NOT NULL,
  input            jsonb,
  output           jsonb,
  steps            jsonb        DEFAULT '[]',
  total_latency_ms integer,
  error            text,
  app_version      text,
  env              text,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE public.engine_traces ENABLE ROW LEVEL SECURITY;

-- Service-role bypasses RLS; deny all direct user access
CREATE POLICY "deny_direct_access" ON public.engine_traces
  USING (false)
  WITH CHECK (false);
