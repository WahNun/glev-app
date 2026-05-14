-- cgm_samples — continuous CGM reading store (Option B).
--
-- Today Glev only persists CGM values AROUND user events:
--   meal_glucose_samples / bolus_glucose_samples /
--   exercise_glucose_samples — written by /api/cgm-jobs/process when a
--   pending fetch job resolves. Apple Health users get a continuous
--   stream into apple_health_readings via the iOS shell push, but
--   LibreLinkUp and Nightscout users have NO continuous storage —
--   readings between events are lost. That hides clinical hypos that
--   happen with no logged context (e.g. a 5h morning low without a
--   meal/bolus/exercise nearby), which is the gap Insights' hypo /
--   TBR / variability tiles need to surface.
--
-- This migration adds a single cross-source continuous-readings table
-- that the new */5min cgm-poll cron writes into for LLU + Nightscout
-- users. Apple Health users are NOT polled — they already have a
-- continuous stream in apple_health_readings (push from device) and
-- the unified read helper (lib/cgm/samples.ts) reads from BOTH tables
-- so callers stay source-agnostic.
--
-- Idempotent (safe to re-run via npm run db:migrate).

CREATE TABLE IF NOT EXISTS cgm_samples (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Sample timestamp (point-in-time CGM reading). For LLU this is the
  -- `Timestamp` field on a graphData row, for Nightscout the `dateString`.
  timestamp   timestamptz NOT NULL,
  -- Server-side normalised mg/dL value (rounded integer). Sources that
  -- speak mmol/L convert before insert.
  value_mgdl  integer     NOT NULL CHECK (value_mgdl > 0 AND value_mgdl < 1000),
  -- Which CGM source produced this row. Pinned to the same set as
  -- profiles.cgm_source. Lets a future debug view tell apart "LLU
  -- pulled" from "Nightscout pulled" rows for the same user (e.g. if
  -- the user switched sources mid-week).
  source      text        NOT NULL CHECK (source IN ('llu', 'nightscout')),
  -- When the row was written by the cron. Useful for debugging gaps
  -- ("why is there no row at 11:42 today?" → look at last
  -- inserted_at vs the cron schedule).
  inserted_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent upsert key — the cron pulls the LLU/Nightscout history
-- on every */5min tick which overlaps the previous tick's window. We
-- want repeated polls of the same window to be no-ops, not duplicate
-- inserts. (user_id, timestamp) is the natural PK; without source in
-- the key we'd reject a NS row that happens to land on the exact
-- same timestamp as an LLU row for the same user. That's intentional
-- and what we want — same user / same minute = one canonical reading.
CREATE UNIQUE INDEX IF NOT EXISTS cgm_samples_user_ts_uidx
  ON cgm_samples (user_id, timestamp);

-- Hot-path index for "last N readings for user X in window Y..Z" — order
-- DESC so a top-N scan walks the newest rows first.
CREATE INDEX IF NOT EXISTS cgm_samples_user_ts_idx
  ON cgm_samples (user_id, timestamp DESC);

-- RLS — same shape as apple_health_readings. The cron + read helpers
-- use the service-role client (lib/cgm/supabase.ts) which bypasses
-- RLS, so the policies are pure defense-in-depth for any direct
-- PostgREST call.
ALTER TABLE cgm_samples ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  tablename = 'cgm_samples'
      AND  policyname = 'cgm_samples_select_self'
  ) THEN
    CREATE POLICY cgm_samples_select_self
      ON cgm_samples
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;
