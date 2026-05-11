-- Beta-Free-Year program: profile-level expiry for admin-granted plans.
--
-- `manual_plan_override` (added in 20260510) grants a tier without going
-- through Stripe; this column lets the admin attach an expiry to it.
-- `computeEffectivePlan` treats an override whose `manual_plan_expires_at`
-- is in the past as if it were unset (falls back to `plan` / 'free').
--
-- NULL = no expiry (lifetime grant) — preserves existing behaviour for
-- every override granted before this column existed.
--
-- Idempotent.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS manual_plan_expires_at timestamptz;
