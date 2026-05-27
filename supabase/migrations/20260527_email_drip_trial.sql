-- Add free-trial support to email_drip_schedule:
--   1. Extend tier CHECK to include 'free_trial'
--   2. Extend email_type CHECK to include trial reminder types

ALTER TABLE public.email_drip_schedule
  DROP CONSTRAINT IF EXISTS email_drip_schedule_tier_check;

ALTER TABLE public.email_drip_schedule
  ADD CONSTRAINT email_drip_schedule_tier_check
  CHECK (tier IN ('beta', 'pro', 'plus', 'free_trial'));

ALTER TABLE public.email_drip_schedule
  DROP CONSTRAINT IF EXISTS email_drip_schedule_email_type_check;

ALTER TABLE public.email_drip_schedule
  ADD CONSTRAINT email_drip_schedule_email_type_check
  CHECK (email_type IN (
    'day7_insights',
    'day14_feedback',
    'day30_trustpilot',
    'trial_day6_reminder',
    'trial_expired'
  ));
