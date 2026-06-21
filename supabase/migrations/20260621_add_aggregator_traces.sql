CREATE TABLE IF NOT EXISTS public.aggregator_traces (
  id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid,
  input_text             text         NOT NULL,
  parsed_food            jsonb,
  lookups                jsonb        DEFAULT '[]',
  final_nutrition_source text,
  final_macros           jsonb,
  total_latency_ms       integer,
  llm_request_id         text,
  aggregator_version     text,
  env                    text,
  created_at             timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE public.aggregator_traces ENABLE ROW LEVEL SECURITY;

-- Service-role bypasses RLS; deny all direct user access
CREATE POLICY "deny_direct_access" ON public.aggregator_traces
  USING (false)
  WITH CHECK (false);
