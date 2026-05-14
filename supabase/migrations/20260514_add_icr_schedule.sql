-- user_icr_schedule — per-user time-banded insulin-to-carb ratios.
--
-- Matildav's request (2 upvotes on Featurebase): one global ICR
-- doesn't fit users whose insulin sensitivity changes across the day
-- (typical pattern: more resistant in the morning, sensitive at
-- night). This table stores up to 3 free-form time slots per user
-- with their own ICR and a free-text label. A master toggle on
-- user_settings.icr_schedule_enabled gates whether the engine looks
-- this up at all — when off, the existing single-ICR path is used.
--
-- Phase A scope (2026-05-14): table + UI capture only. The engine
-- (lib/engine/adaptiveICR.ts) does NOT consult this yet — that lands
-- in Phase B once Lucas has confirmed the data shape feels right.
--
-- Idempotent (safe to re-run via npm run db:migrate).

CREATE TABLE IF NOT EXISTS user_icr_schedule (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 1, 2, 3 — three slots max per user (Lucas-spec).
  slot_index    smallint    NOT NULL CHECK (slot_index BETWEEN 1 AND 3),
  -- Free-text label (e.g. "Morgen", "Mittag", "Abend"). Nullable so a
  -- user can leave one empty without breaking insertion. The Settings
  -- UI shows placeholder text suggesting names; user picks freely.
  label         text,
  -- Minute-of-day, 0..1439. Granular per Lucas-spec ("auf die Minute
  -- einstellbar"). Slots may wrap midnight (start > end means the
  -- window crosses 00:00 — engine will handle the modulo).
  start_minute  smallint    NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute    smallint    NOT NULL CHECK (end_minute   BETWEEN 0 AND 1439),
  -- ICR in g of carb per 1u rapid insulin. Same scale as
  -- user_settings.icr_g_per_unit so the engine can swap them 1:1.
  icr_g_per_unit  integer   NOT NULL CHECK (icr_g_per_unit BETWEEN 1 AND 100),
  -- Per-slot enabled flag — lets a user keep saved values for a slot
  -- they're temporarily not using without losing the config.
  enabled       boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Exactly one row per (user, slot) — UPSERT-friendly.
  UNIQUE (user_id, slot_index)
);

COMMENT ON TABLE  user_icr_schedule IS 'Per-user time-banded ICRs (Matildav request). Engine reads when user_settings.icr_schedule_enabled = true.';
COMMENT ON COLUMN user_icr_schedule.slot_index   IS '1, 2, 3 — three free-form slots per user.';
COMMENT ON COLUMN user_icr_schedule.start_minute IS 'Minute of day, 0..1439. start>end means slot wraps midnight.';
COMMENT ON COLUMN user_icr_schedule.end_minute   IS 'Minute of day, 0..1439. start>end means slot wraps midnight.';

-- Master toggle on user_settings — when false, the engine ignores
-- user_icr_schedule entirely and uses the single-ICR path. Default
-- false so existing users see zero behaviour change.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS icr_schedule_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_settings.icr_schedule_enabled
  IS 'Master toggle for time-banded ICRs (user_icr_schedule). False → engine uses single icr_g_per_unit.';

-- Hot-path index — engine will look up "active slot for user X at minute Y".
CREATE INDEX IF NOT EXISTS user_icr_schedule_user_idx
  ON user_icr_schedule (user_id);

-- RLS — same shape as cgm_samples / user_settings. API route uses the
-- authenticated client so policies enforce per-user scoping; defense
-- in depth for any direct PostgREST call.
ALTER TABLE user_icr_schedule ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_icr_schedule' AND policyname='user_icr_schedule_select_self') THEN
    CREATE POLICY user_icr_schedule_select_self ON user_icr_schedule FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_icr_schedule' AND policyname='user_icr_schedule_insert_self') THEN
    CREATE POLICY user_icr_schedule_insert_self ON user_icr_schedule FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_icr_schedule' AND policyname='user_icr_schedule_update_self') THEN
    CREATE POLICY user_icr_schedule_update_self ON user_icr_schedule FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_icr_schedule' AND policyname='user_icr_schedule_delete_self') THEN
    CREATE POLICY user_icr_schedule_delete_self ON user_icr_schedule FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;
