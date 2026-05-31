-- Tracks how a user account was created.
-- 'meta_lead'  = created via Meta Ads lead form (admin or Resend inbound webhook)
-- NULL         = regular self-signup
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signup_source TEXT DEFAULT NULL;

COMMENT ON COLUMN public.profiles.signup_source IS
  'Origin of account creation: meta_lead | NULL (self-signup)';
