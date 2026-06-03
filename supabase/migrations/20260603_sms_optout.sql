-- SMS Opt-Out Compliance (UWG/TKG)
-- Adds sms_opted_out columns to profiles and creates sms_optout_events audit table.
--
-- profiles.sms_opted_out: guards all Twilio send paths.
-- sms_optout_events: immutable audit trail (one row per opt-out event).
--
-- Note: profiles PK is user_id (not id) — FK uses user_id.
-- Idempotent (safe to re-run).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sms_opted_out     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_opted_out_at  TIMESTAMPTZ NULL;

COMMENT ON COLUMN profiles.sms_opted_out IS
  'TRUE when the user opted out of marketing SMS via glev.app/sms-stop.';
COMMENT ON COLUMN profiles.sms_opted_out_at IS
  'Timestamp of the opt-out. NULL when sms_opted_out is FALSE.';

CREATE TABLE IF NOT EXISTS sms_optout_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  opted_out_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip            TEXT,
  user_agent    TEXT,
  token_used    TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS sms_optout_events_user_id_idx
  ON sms_optout_events (user_id);

COMMENT ON TABLE sms_optout_events IS
  'Immutable audit log of SMS opt-out events. One row per opt-out click.';

ALTER TABLE sms_optout_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sms_optout_events' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON sms_optout_events
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
