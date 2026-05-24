-- Migration: server-side hypo push cooldown table
-- Task #693: Server-side Hypo-Push via Supabase Edge Function
--
-- Stores the last time a server-side hypo push was sent to each user.
-- This survives across serverless invocations — unlike the local
-- localStorage cooldown in lowGlucoseAlarm.ts, which only works when the
-- app is open.
--
-- Access: service role only. No RLS policies for authenticated users —
-- this table is only ever read/written by the Edge Function's service-role
-- client. Users do not need (and should not have) access to cooldown state.
--
-- Idempotent (safe to re-run via pnpm db:migrate).

CREATE TABLE IF NOT EXISTS hypo_push_cooldown (
  user_id      UUID        PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE hypo_push_cooldown IS
  'Server-side cooldown tracker for hypo push notifications. One row per user. '
  'Prevents push spam during a sustained hypo. Service-role only.';

COMMENT ON COLUMN hypo_push_cooldown.user_id IS
  'References profiles.user_id. Cascades on delete.';
COMMENT ON COLUMN hypo_push_cooldown.last_sent_at IS
  'UTC timestamp of the last hypo push sent to this user. '
  'Edge Function skips sending if NOW() - last_sent_at < 15 minutes.';

ALTER TABLE hypo_push_cooldown ENABLE ROW LEVEL SECURITY;
