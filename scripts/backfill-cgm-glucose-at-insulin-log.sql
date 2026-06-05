-- scripts/backfill-cgm-glucose-at-insulin-log.sql
--
-- One-time backfill: populate cgm_glucose_at_log on insulin_logs rows
-- that were created via the AI voice path before 2026-06-04, when
-- execLogBolusEntry / execLogBasalEntry did not fetch CGM at save time.
--
-- Strategy: for every insulin_log with cgm_glucose_at_log IS NULL, find
-- the CGM reading (from cgm_samples OR apple_health_readings) closest in
-- time to created_at, within a ±10-minute window.  Only the single
-- nearest reading is used.  If no reading falls within the window, the
-- row is left NULL — do NOT invent a value.
--
-- Run once in the Supabase SQL editor or via psql:
--   psql $DATABASE_URL -f scripts/backfill-cgm-glucose-at-insulin-log.sql
--
-- Idempotent: only updates rows where cgm_glucose_at_log IS NULL.
-- Safe to re-run — already-filled rows are untouched.
--
-- Estimated impact (Lucas's account, 2026-06-04): all Tresiba basal logs
-- saved via voice before the fix.  Bolus logs saved via UI were already
-- correct (Engine page supplied the value).

WITH window_secs AS (
  SELECT 600 AS secs   -- ±10 minutes
),

-- All NULL-glucose insulin log rows we want to backfill
candidates AS (
  SELECT
    il.id                                     AS log_id,
    il.user_id,
    il.created_at,
    EXTRACT(EPOCH FROM il.created_at)::bigint AS log_epoch
  FROM insulin_logs il
  WHERE il.cgm_glucose_at_log IS NULL
),

-- Nearest reading from cgm_samples (LLU + Nightscout users)
from_cgm_samples AS (
  SELECT DISTINCT ON (c.log_id)
    c.log_id,
    s.value_mgdl::numeric(5,1)                      AS bg_value,
    ABS(EXTRACT(EPOCH FROM s.timestamp) - c.log_epoch) AS dist_secs
  FROM candidates c
  JOIN cgm_samples s
    ON  s.user_id  = c.user_id::uuid   -- insulin_logs.user_id is text; cgm_samples is uuid
    AND s.timestamp BETWEEN c.created_at - INTERVAL '10 minutes'
                        AND c.created_at + INTERVAL '10 minutes'
  ORDER BY c.log_id, dist_secs ASC
),

-- Nearest reading from apple_health_readings (Apple Health users)
from_apple AS (
  SELECT DISTINCT ON (c.log_id)
    c.log_id,
    a.value_mg_dl::numeric(5,1)                      AS bg_value,
    ABS(EXTRACT(EPOCH FROM a.timestamp) - c.log_epoch) AS dist_secs
  FROM candidates c
  JOIN apple_health_readings a
    ON  a.user_id  = c.user_id::uuid   -- insulin_logs.user_id is text; apple_health_readings is uuid
    AND a.timestamp BETWEEN c.created_at - INTERVAL '10 minutes'
                        AND c.created_at + INTERVAL '10 minutes'
  ORDER BY c.log_id, dist_secs ASC
),

-- Pick the closer of the two sources per log (prefer cgm_samples on tie)
best_reading AS (
  SELECT DISTINCT ON (log_id)
    log_id,
    bg_value
  FROM (
    SELECT log_id, bg_value, dist_secs FROM from_cgm_samples
    UNION ALL
    SELECT log_id, bg_value, dist_secs FROM from_apple
  ) combined
  ORDER BY log_id, dist_secs ASC
)

-- Apply the backfill
UPDATE insulin_logs il
SET    cgm_glucose_at_log = br.bg_value
FROM   best_reading br
WHERE  il.id = br.log_id
  AND  il.cgm_glucose_at_log IS NULL;   -- idempotency guard

-- Report how many rows were updated
-- (run SELECT count(*) FROM insulin_logs WHERE cgm_glucose_at_log IS NULL
--  before/after to measure coverage)
