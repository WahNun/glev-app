-- Click tracking + re-engagement support
--
-- 1. profiles.last_seen_at — für Re-Engagement-Cron (wann war User zuletzt aktiv?)
-- 2. email_drip_schedule.clicked_at — erste Link-Klick-Zeit aus Emails (Click-Tracking)
-- 3. email_type CHECK erweitert um 're_engagement'

-- 1. last_seen_at
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS profiles_last_seen_at_idx
  ON public.profiles (last_seen_at)
  WHERE last_seen_at IS NOT NULL;

-- 2. clicked_at
ALTER TABLE public.email_drip_schedule
  ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ DEFAULT NULL;

-- 3. email_type CHECK
ALTER TABLE public.email_drip_schedule
  DROP CONSTRAINT IF EXISTS email_drip_schedule_email_type_check;

ALTER TABLE public.email_drip_schedule
  ADD CONSTRAINT email_drip_schedule_email_type_check
  CHECK (email_type IN (
    'day7_insights',
    'day14_feedback',
    'day30_trustpilot',
    'trial_day6_reminder',
    'trial_expired',
    're_engagement'
  ));
