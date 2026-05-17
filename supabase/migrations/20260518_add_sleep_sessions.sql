-- Apple Health sleep sync — `sleep_sessions` stores one row per night
-- (or per nap) so the Engine and Insights can use sleep duration as a
-- contextual signal for next-day insulin sensitivity.
--
-- Design decisions:
--
--   * One row per *session*, not per HK phase fragment. HealthKit emits
--     SleepAnalysis as dozens of overlapping samples per night (inBed,
--     asleepCore, asleepDeep, asleepREM, asleepUnspecified, awake). The
--     iOS native code aggregates them into one session before pushing,
--     so the backend stays simple and the Engine can read "asleep
--     minutes last night" with one query.
--   * `source_uuid` is a deterministic hash of the session window
--     produced on-device (HealthKit gives one UUID per fragment, not
--     per aggregated session). The aggregator computes
--     sha1(start_at|end_at) so re-pushing the same night = no-op.
--   * Optional phase breakdown columns (`deep_minutes`, `rem_minutes`,
--     `core_minutes`, `awake_minutes`) are nullable — Apple Watch users
--     get them, iPhone-only sleep tracking does not. Engine logic must
--     gracefully degrade to `asleep_minutes` only.
--   * `source` defaults to 'apple_health' with a CHECK that allows
--     future expansion (manual entry, Whoop direct, Oura direct) by a
--     one-line constraint update.
--   * Compliance: this table only stores observation data. The Engine
--     uses it as a *hint* ("kurzer Schlaf — Insulin-Empfindlichkeit
--     kann reduziert sein") never as a dose modifier. See replit.md
--     Compliance Backlog.
--
-- Idempotent (safe to re-run via npm run db:migrate).

CREATE TABLE IF NOT EXISTS sleep_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Per-session dedup key (sha1 of the aggregated window, computed
  -- on-device — see lib/healthkit/sleepAggregator.ts in the upcoming
  -- iOS bridge work).
  source_uuid     text        NOT NULL,
  -- The actual sleep window in user local time, converted to UTC by
  -- the device before upload.
  start_at        timestamptz NOT NULL,
  end_at          timestamptz NOT NULL,
  -- Aggregated durations (rounded minutes). asleep_minutes is the
  -- canonical "how long did the user actually sleep" metric — the
  -- Engine reads this one.
  in_bed_minutes  integer     NOT NULL CHECK (in_bed_minutes  >= 0 AND in_bed_minutes  <= 1440),
  asleep_minutes  integer     NOT NULL CHECK (asleep_minutes  >= 0 AND asleep_minutes  <= 1440),
  -- Optional phase breakdown (Apple Watch only).
  deep_minutes    smallint             CHECK (deep_minutes  IS NULL OR (deep_minutes  >= 0 AND deep_minutes  <= 1440)),
  rem_minutes     smallint             CHECK (rem_minutes   IS NULL OR (rem_minutes   >= 0 AND rem_minutes   <= 1440)),
  core_minutes    smallint             CHECK (core_minutes  IS NULL OR (core_minutes  >= 0 AND core_minutes  <= 1440)),
  awake_minutes   smallint             CHECK (awake_minutes IS NULL OR (awake_minutes >= 0 AND awake_minutes <= 1440)),
  source          text        NOT NULL DEFAULT 'apple_health',
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Sanity: end after start, asleep <= in_bed.
  CONSTRAINT sleep_sessions_window_check       CHECK (end_at > start_at),
  CONSTRAINT sleep_sessions_asleep_bound_check CHECK (asleep_minutes <= in_bed_minutes)
);

-- CHECK on `source` via DO block so a future expansion is a single
-- ALTER without breaking existing data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE  table_name = 'sleep_sessions'
      AND  constraint_name = 'sleep_sessions_source_check'
  ) THEN
    ALTER TABLE sleep_sessions
      ADD CONSTRAINT sleep_sessions_source_check
      CHECK (source IN ('apple_health'));
  END IF;
END $$;

-- Idempotent re-uploads: same (user, session-hash) twice = no-op.
CREATE UNIQUE INDEX IF NOT EXISTS sleep_sessions_user_uuid_uidx
  ON sleep_sessions (user_id, source_uuid);

-- Hot-path index for "last night's sleep for user X" — the Engine
-- pre-meal-recommendation hook reads this on every recommendation
-- request, so DESC ordering is the forward-walk path.
CREATE INDEX IF NOT EXISTS sleep_sessions_user_start_idx
  ON sleep_sessions (user_id, start_at DESC);

-- RLS — mirrors apple_health_readings: server-side ingest uses the
-- service-role client (bypasses RLS), policies are defense-in-depth
-- for direct PostgREST access.
ALTER TABLE sleep_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  tablename = 'sleep_sessions'
      AND  policyname = 'sleep_sessions_select_self'
  ) THEN
    CREATE POLICY sleep_sessions_select_self
      ON sleep_sessions
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  tablename = 'sleep_sessions'
      AND  policyname = 'sleep_sessions_insert_self'
  ) THEN
    CREATE POLICY sleep_sessions_insert_self
      ON sleep_sessions
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  tablename = 'sleep_sessions'
      AND  policyname = 'sleep_sessions_delete_self'
  ) THEN
    CREATE POLICY sleep_sessions_delete_self
      ON sleep_sessions
      FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
