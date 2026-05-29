-- Refer-a-Friend System
-- Adds referral_code to profiles (lazy-generated 7-char code)
-- and a referrals tracking table.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

COMMENT ON COLUMN public.profiles.referral_code IS
  'Unique 7-char referral code (uppercase letters + digits, no ambiguous chars). Generated lazily via /api/me/referral.';

CREATE TABLE IF NOT EXISTS public.referrals (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  referred_user_id UUID        REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  referral_code    TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'rewarded')),
  rewarded_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_user_id);
CREATE INDEX IF NOT EXISTS referrals_code_idx     ON public.referrals (referral_code);
CREATE INDEX IF NOT EXISTS referrals_referred_idx ON public.referrals (referred_user_id);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own referrals as referrer"
  ON public.referrals FOR SELECT
  USING (referrer_user_id = auth.uid());

CREATE POLICY "Users read own referral entry as referred"
  ON public.referrals FOR SELECT
  USING (referred_user_id = auth.uid());

COMMENT ON TABLE public.referrals IS
  'Tracks every referral link-click → signup pair and its reward status.';
