-- Add subscription_source to profiles for cross-platform entitlement tracking.
-- Values: 'stripe' | 'apple_iap' | 'google_play' | NULL (unknown/legacy)
-- Source-of-Truth for plan access: profiles (NOT RevenueCat CustomerInfo).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_source TEXT DEFAULT NULL;

-- Backfill existing Stripe subscribers: any row with subscription_status='active'
-- and no source set is assumed Stripe (all pre-IAP subs were Stripe-only).
UPDATE public.profiles
SET subscription_source = 'stripe'
WHERE subscription_source IS NULL
  AND subscription_status = 'active';

COMMENT ON COLUMN public.profiles.subscription_source IS
  'Purchase origin: stripe | apple_iap | google_play | NULL';
