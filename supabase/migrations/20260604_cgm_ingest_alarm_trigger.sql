-- Migration: 20260604_cgm_ingest_alarm_trigger.sql
--
-- Sets up Postgres triggers on apple_health_readings and nightscout_readings
-- that fire the cgm-ingest-alarm edge function via pg_net on every INSERT
-- of a RECENT reading (≤ 15 minutes old). Backfill/history inserts are
-- silently skipped at the trigger level via WHEN clauses.
--
-- This brings alarm latency from up to 10 minutes (worst-case 5-min cron gap)
-- down to under 1 minute for Apple Health and Nightscout users.
-- LLU users continue to rely on the 5-minute cron (hypo/elevated/hyper-check).
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  ONE-TIME SETUP — run once in Supabase SQL Editor per environment:      │
-- │                                                                         │
-- │  ALTER DATABASE postgres                                                │
-- │    SET app.supabase_edge_base_url TO                                   │
-- │    'https://<your-project-ref>.supabase.co/functions/v1';              │
-- │                                                                         │
-- │  The service role key is available via the Supabase built-in GUC       │
-- │  app.settings.service_role_key — no extra setup needed for auth.       │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- Requires: pg_net extension (pre-installed on all Supabase projects as net.*).

-- ── Atomic cooldown claim function ───────────────────────────────────────────
--
-- try_claim_alarm_cooldown(user_id, cooldown_table, cooldown_minutes)
--
-- Uses a single INSERT ... ON CONFLICT DO UPDATE ... WHERE to atomically
-- claim a cooldown slot. Returns TRUE if the caller won the race (= should
-- send a push), FALSE if the cooldown is still active (= skip).
--
-- This is the only safe pattern when multiple edge function invocations can
-- run concurrently for the same user (e.g. from a batch Nightscout upsert
-- where multiple rows happen to be recent).

CREATE OR REPLACE FUNCTION public.try_claim_alarm_cooldown(
  p_user_id       uuid,
  p_cooldown_table text,
  p_cooldown_minutes int DEFAULT 15
) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_claimed boolean;
BEGIN
  CASE p_cooldown_table
    WHEN 'hypo_push_cooldown' THEN
      WITH upsert AS (
        INSERT INTO public.hypo_push_cooldown (user_id, last_sent_at)
             VALUES (p_user_id, NOW())
        ON CONFLICT (user_id) DO UPDATE
              SET last_sent_at = NOW()
            WHERE public.hypo_push_cooldown.last_sent_at
                  < NOW() - (p_cooldown_minutes || ' minutes')::interval
        RETURNING user_id
      )
      SELECT COUNT(*) > 0 INTO v_claimed FROM upsert;

    WHEN 'elevated_push_cooldown' THEN
      WITH upsert AS (
        INSERT INTO public.elevated_push_cooldown (user_id, last_sent_at)
             VALUES (p_user_id, NOW())
        ON CONFLICT (user_id) DO UPDATE
              SET last_sent_at = NOW()
            WHERE public.elevated_push_cooldown.last_sent_at
                  < NOW() - (p_cooldown_minutes || ' minutes')::interval
        RETURNING user_id
      )
      SELECT COUNT(*) > 0 INTO v_claimed FROM upsert;

    WHEN 'hyper_push_cooldown' THEN
      WITH upsert AS (
        INSERT INTO public.hyper_push_cooldown (user_id, last_sent_at)
             VALUES (p_user_id, NOW())
        ON CONFLICT (user_id) DO UPDATE
              SET last_sent_at = NOW()
            WHERE public.hyper_push_cooldown.last_sent_at
                  < NOW() - (p_cooldown_minutes || ' minutes')::interval
        RETURNING user_id
      )
      SELECT COUNT(*) > 0 INTO v_claimed FROM upsert;

    ELSE
      RAISE EXCEPTION '[try_claim_alarm_cooldown] unknown cooldown table: %', p_cooldown_table;
  END CASE;

  RETURN v_claimed;
END;
$$;

COMMENT ON FUNCTION public.try_claim_alarm_cooldown(uuid, text, int) IS
  'Atomically claims a per-user alarm cooldown slot via INSERT ... ON CONFLICT DO UPDATE WHERE. '
  'Returns TRUE if this call won the race and should send a push notification; '
  'FALSE if another concurrent call already claimed the slot within the cooldown window. '
  'Supported tables: hypo_push_cooldown, elevated_push_cooldown, hyper_push_cooldown.';

-- Restrict execution to service-role only.  anon/authenticated users must
-- not be able to suppress or manipulate alarm cooldowns via RPC.
REVOKE EXECUTE ON FUNCTION public.try_claim_alarm_cooldown(uuid, text, int)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.try_claim_alarm_cooldown(uuid, text, int)
  TO service_role;

-- ── Cooldown release function ─────────────────────────────────────────────────
--
-- release_alarm_cooldown(user_id, cooldown_table)
--
-- Called by the edge function when a push delivery fails AFTER the cooldown
-- was already claimed.  Resets last_sent_at so the next 5-minute cron
-- run can still deliver the alert — preserving the cron as a safety net.

CREATE OR REPLACE FUNCTION public.release_alarm_cooldown(
  p_user_id       uuid,
  p_cooldown_table text
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  CASE p_cooldown_table
    WHEN 'hypo_push_cooldown' THEN
      DELETE FROM public.hypo_push_cooldown WHERE user_id = p_user_id;
    WHEN 'elevated_push_cooldown' THEN
      DELETE FROM public.elevated_push_cooldown WHERE user_id = p_user_id;
    WHEN 'hyper_push_cooldown' THEN
      DELETE FROM public.hyper_push_cooldown WHERE user_id = p_user_id;
    ELSE
      RAISE EXCEPTION '[release_alarm_cooldown] unknown cooldown table: %', p_cooldown_table;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.release_alarm_cooldown(uuid, text) IS
  'Deletes the cooldown row for a user+alarm-type after a failed push delivery, '
  'allowing the next cron run to retry the alarm. '
  'Must be called whenever try_claim_alarm_cooldown returned TRUE but push failed.';

REVOKE EXECUTE ON FUNCTION public.release_alarm_cooldown(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_alarm_cooldown(uuid, text)
  TO service_role;

-- ── Trigger function ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fire_cgm_ingest_alarm()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, net
AS $$
DECLARE
  v_base_url    text;
  v_service_key text;
  v_payload     text;
BEGIN
  -- Read configuration GUCs; silently no-op if not set (never break an INSERT)
  v_base_url    := current_setting('app.supabase_edge_base_url', true);
  v_service_key := current_setting('app.settings.service_role_key', true);

  IF v_base_url IS NULL OR v_base_url = '' THEN
    RAISE LOG '[cgm-ingest-alarm] app.supabase_edge_base_url not set — skipping webhook for table=%', TG_TABLE_NAME;
    RETURN NEW;
  END IF;

  -- Build payload matching the Supabase Database Webhook body shape
  v_payload := json_build_object(
    'table',  TG_TABLE_NAME,
    'record', row_to_json(NEW)
  )::text;

  -- Fire-and-forget via pg_net (net.http_post lives in the net schema).
  -- net.http_post signature: (url text, body text, params jsonb, headers jsonb, timeout_ms int)
  -- Returns a request ID (bigint) that we discard — the call is non-blocking.
  PERFORM net.http_post(
    url     := v_base_url || '/cgm-ingest-alarm',
    body    := v_payload,
    params  := '{}'::jsonb,
    headers := json_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || COALESCE(v_service_key, '')
               )::jsonb,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Safety net: pg_net errors must never abort the original INSERT
  RAISE LOG '[cgm-ingest-alarm] pg_net error on table=% sqlstate=% msg=%',
            TG_TABLE_NAME, SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$$;

-- ── Triggers ─────────────────────────────────────────────────────────────────
--
-- WHEN clauses filter out historical/backfill rows at the DB level — only
-- rows with a timestamp within the last 15 minutes fire the webhook.
-- This prevents notification storms from Nightscout batch upserts or
-- Apple Health history sync.

-- Apple Health readings (pushed by the iOS HealthKit sync on every new reading)
-- Column name: "timestamp" (timestamptz)
DROP TRIGGER IF EXISTS cgm_ingest_alarm_apple_health ON public.apple_health_readings;
CREATE TRIGGER cgm_ingest_alarm_apple_health
  AFTER INSERT ON public.apple_health_readings
  FOR EACH ROW
  WHEN (NEW.timestamp > NOW() - INTERVAL '15 minutes')
  EXECUTE FUNCTION public.fire_cgm_ingest_alarm();

-- Nightscout readings (written by the Nightscout sync route on every poll)
-- Column name: "recorded_at" (timestamptz)
DROP TRIGGER IF EXISTS cgm_ingest_alarm_nightscout ON public.nightscout_readings;
CREATE TRIGGER cgm_ingest_alarm_nightscout
  AFTER INSERT ON public.nightscout_readings
  FOR EACH ROW
  WHEN (NEW.recorded_at > NOW() - INTERVAL '15 minutes')
  EXECUTE FUNCTION public.fire_cgm_ingest_alarm();

-- ── Comments ──────────────────────────────────────────────────────────────────

COMMENT ON FUNCTION public.fire_cgm_ingest_alarm() IS
  'Sends an async HTTP POST to the cgm-ingest-alarm edge function via pg_net '
  'on INSERT of a RECENT row (≤ 15 min old) into apple_health_readings or '
  'nightscout_readings. Historical/backfill rows are filtered by the trigger '
  'WHEN clause before this function is ever called. '
  'Requires app.supabase_edge_base_url GUC — see migration comment for setup.';
