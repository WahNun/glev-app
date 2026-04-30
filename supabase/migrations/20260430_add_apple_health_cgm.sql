-- Apple Health (HealthKit) — third CGM source alongside LibreLinkUp
-- (lib/cgm/llu.ts) and Nightscout (lib/cgm/nightscout.ts). Apple Health
-- is read on-device via Capacitor's native bridge — there is no
-- server-pull pattern (Apple does not expose HealthKit to a backend).
-- The iOS app pushes the user's blood-glucose samples to a backend
-- cache so the existing dispatcher (lib/cgm/index.ts) can serve them
-- the same way it serves Nightscout / LLU.
--
-- This migration adds two things:
--
-- 1. profiles.cgm_source — explicit per-user CGM-source preference.
--    Today the dispatcher INFERS source (Nightscout if nightscout_url
--    is set, else LLU). That implicit rule does not extend cleanly to
--    Apple Health, which has no credentials in `profiles`. The new
--    column is the user's pinned choice; NULL means "legacy / auto"
--    so existing users keep working untouched. Allowed values:
--      'llu' | 'nightscout' | 'apple_health'
--    Enforced via a CHECK constraint instead of a Postgres ENUM so
--    future additions are a one-line ALTER instead of an enum migration.
--
-- 2. apple_health_readings — server-side cache of the user's HealthKit
--    blood-glucose samples. The native shell pushes deltas; the server
--    deduplicates per HealthKit UUID (idempotent re-uploads) and the
--    Apple-Health adapter (lib/cgm/appleHealth.ts) reads the latest
--    history out of this table.
--
-- Idempotent (safe to re-run via npm run db:migrate).

-- 1. cgm_source preference column ------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS cgm_source text;

-- CHECK constraint — only add if it does not already exist so re-running
-- the migration is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   information_schema.constraint_column_usage
    WHERE  table_name = 'profiles'
      AND  constraint_name = 'profiles_cgm_source_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_cgm_source_check
      CHECK (cgm_source IS NULL
             OR cgm_source IN ('llu', 'nightscout', 'apple_health'));
  END IF;
END $$;

-- 2. apple_health_readings -------------------------------------------------
CREATE TABLE IF NOT EXISTS apple_health_readings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- HealthKit's per-sample UUID (HKObject.uuid). Used to deduplicate
  -- re-uploads of the same sample (the device pushes overlapping
  -- windows on every foreground sync to keep the math simple).
  source_uuid  text        NOT NULL,
  -- Sample timestamp (samples are point-in-time, so we store HK's
  -- startDate which equals endDate for blood-glucose samples).
  timestamp    timestamptz NOT NULL,
  -- Server-side normalised mg/dL value (rounded integer). The
  -- conversion mmol/L → mg/dL (factor 18.0182) lives in the ingest
  -- route so callers (the device, future tests) only need to send the
  -- raw HealthKit unit.
  value_mg_dl  integer     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Idempotent uploads: same (user, HK UUID) twice = no-op.
CREATE UNIQUE INDEX IF NOT EXISTS apple_health_readings_user_uuid_uidx
  ON apple_health_readings (user_id, source_uuid);

-- Hot-path index for getLatest(userId) and getHistory(userId) — order
-- DESC so a top-N scan is a forward index walk on the freshest rows.
CREATE INDEX IF NOT EXISTS apple_health_readings_user_ts_idx
  ON apple_health_readings (user_id, timestamp DESC);

-- RLS — users can only see / mutate their own readings. The server-side
-- ingest + adapter use the service-role client (lib/cgm/supabase.ts)
-- which bypasses RLS, so the policies here are a pure defense-in-depth
-- layer for any direct PostgREST call.
ALTER TABLE apple_health_readings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  tablename = 'apple_health_readings'
      AND  policyname = 'apple_health_readings_select_self'
  ) THEN
    CREATE POLICY apple_health_readings_select_self
      ON apple_health_readings
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  tablename = 'apple_health_readings'
      AND  policyname = 'apple_health_readings_insert_self'
  ) THEN
    CREATE POLICY apple_health_readings_insert_self
      ON apple_health_readings
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  tablename = 'apple_health_readings'
      AND  policyname = 'apple_health_readings_delete_self'
  ) THEN
    CREATE POLICY apple_health_readings_delete_self
      ON apple_health_readings
      FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
