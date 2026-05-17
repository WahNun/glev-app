-- Per-user time-format preference for clock displays across the app
-- (Entries stream, Engine, Insights, etc.).
--
-- Values:
--   'auto' → follow the UI locale (DE → 24h, EN → 12h AM/PM). Default.
--   '24h'  → always 24h, regardless of locale.
--   '12h'  → always AM/PM, regardless of locale.
--
-- We deliberately leave the column NULLable + default to 'auto' so existing
-- users transparently fall into the locale-aware behaviour without a
-- backfill step. Anyone who explicitly picks 24h/12h overrides it.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS time_format text DEFAULT 'auto';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_time_format_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_time_format_check
  CHECK (time_format IN ('auto', '24h', '12h'));
