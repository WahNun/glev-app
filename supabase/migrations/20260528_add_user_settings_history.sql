-- Track every change to the three insulin-parameter columns in
-- `user_settings` (ICR / CF / target BG) so exports and future
-- backfills can reconstruct the ratio that was active at any point
-- in a user's history instead of relying on the "current" value.
--
-- Design
-- ------
-- One row per UPDATE event, storing old+new for each tracked column.
-- A trigger fires AFTER UPDATE FOR EACH ROW; it skips the insert when
-- none of the three columns changed (e.g. brand or macro updates that
-- leave ICR/CF/target unchanged).
--
-- user_id is `text` to match the `auth.uid()::text` convention used by
-- user_settings, insulin_logs, exercise_logs, meals, and every other
-- table in this schema. The FK points at user_settings(user_id) so
-- deleting a settings row cascades the history away cleanly.
--
-- The `changed_at` column is `now()` of the UPDATE transaction, giving
-- a precise "effective from" timestamp. To answer "what was the ICR at
-- log time T?":
--
--   SELECT icr_new
--     FROM user_settings_history
--    WHERE user_id   = :uid
--      AND changed_at <= :T
--      AND icr_new IS NOT NULL
--    ORDER BY changed_at DESC
--    LIMIT 1;
--
-- If no row is found, there was no recorded ICR change before T, so
-- fall back to `icr_old` from the earliest history row (see the backfill
-- migration for the full two-step COALESCE strategy).
--
-- RLS: on but no authenticated policies — admin client only. Authenticated
-- users never read this table directly; export helpers and the backfill
-- migration use the service-role client.
--
-- Idempotent (safe to re-run).

-- 1. History table ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_settings_history (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- text matches user_settings.user_id (auth.uid()::text convention).
  user_id        text        NOT NULL
                               REFERENCES public.user_settings(user_id)
                               ON DELETE CASCADE,
  changed_at     timestamptz NOT NULL DEFAULT now(),

  -- Insulin-to-carb ratio (g carb / IE). NUMERIC(5,1) matches the
  -- parent column after migration 20260515_split_icr_user_engine.sql.
  icr_old        numeric(5,1),
  icr_new        numeric(5,1),

  -- Correction factor (mg/dL drop per IE).
  cf_old         integer,
  cf_new         integer,

  -- Target blood-glucose midpoint (mg/dL).
  target_bg_old  integer,
  target_bg_new  integer
);

-- Fast lookup: "all history rows for user X before timestamp T"
CREATE INDEX IF NOT EXISTS user_settings_history_user_time_idx
  ON public.user_settings_history (user_id, changed_at DESC);

COMMENT ON TABLE public.user_settings_history IS
  'Audit log of every change to user_settings.{icr_g_per_unit, '
  'cf_mgdl_per_unit, target_bg_mgdl}. Used by export helpers to '
  'reconstruct the ratio that was active at any insulin_log row.';

COMMENT ON COLUMN public.user_settings_history.user_id IS
  'auth.uid()::text — matches user_settings.user_id and insulin_logs.user_id.';
COMMENT ON COLUMN public.user_settings_history.icr_old IS
  'ICR value before this UPDATE (NULL when the column was NULL before).';
COMMENT ON COLUMN public.user_settings_history.icr_new IS
  'ICR value after this UPDATE.';

-- RLS: on but no authenticated policies — admin / service-role only.
ALTER TABLE public.user_settings_history ENABLE ROW LEVEL SECURITY;

-- 2. Trigger function -----------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_user_settings_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only record when at least one of the three tracked columns changed.
  -- IS DISTINCT FROM handles NULL correctly (NULL→value and value→NULL
  -- both count as a change; NULL→NULL does not).
  IF (NEW.icr_g_per_unit    IS DISTINCT FROM OLD.icr_g_per_unit)  OR
     (NEW.cf_mgdl_per_unit  IS DISTINCT FROM OLD.cf_mgdl_per_unit) OR
     (NEW.target_bg_mgdl    IS DISTINCT FROM OLD.target_bg_mgdl)
  THEN
    INSERT INTO public.user_settings_history
           (user_id,      changed_at,
            icr_old,              icr_new,
            cf_old,               cf_new,
            target_bg_old,        target_bg_new)
    VALUES (NEW.user_id,  now(),
            OLD.icr_g_per_unit,   NEW.icr_g_per_unit,
            OLD.cf_mgdl_per_unit, NEW.cf_mgdl_per_unit,
            OLD.target_bg_mgdl,   NEW.target_bg_mgdl);
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Attach trigger -------------------------------------------------
-- Drop first so re-running is idempotent.
DROP TRIGGER IF EXISTS trg_user_settings_history ON public.user_settings;

CREATE TRIGGER trg_user_settings_history
  AFTER UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_user_settings_history();

-- Notify PostgREST to reload schema so the new table is immediately
-- available via the REST API (matters for the admin client).
NOTIFY pgrst, 'reload schema';
