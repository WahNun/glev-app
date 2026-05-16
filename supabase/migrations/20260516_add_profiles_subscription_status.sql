-- Add the legacy `profiles.subscription_status` column that the code base
-- assumes exists in every environment but was never actually added to the
-- production Supabase schema.
--
-- Why this matters:
--   * The Beta Stripe webhook (`/api/webhooks/stripe`) writes
--     `profiles.subscription_status = 'beta'` after a successful checkout.
--   * `/api/me/plan` and `computeEffectivePlan()` use it as a legacy
--     fallback when neither `manual_plan_override` nor `profiles.plan`
--     resolves to a paid tier.
--   * Admin user-detail page (`/admin/users/[id]`) reads it for the KV
--     row "profiles.subscription_status".
--
-- Without this column, any SELECT that listed it together with other
-- columns failed with PostgREST 42703, the route catch fell back to
-- "free", and Pro/Beta users saw "GLEV FREE" in the account modal.
--
-- The column is intentionally nullable and has no DEFAULT — existing
-- rows stay NULL, and only the beta webhook (or a future manual
-- backfill) writes to it.
--
-- Idempotent (safe to re-run via scripts/apply-migration.mjs).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS subscription_status text;

-- No CHECK constraint on the values: historically the column was free-form
-- text ('beta', 'active', 'canceled', etc.). Pin nothing here so we don't
-- break older rows or a future webhook revision.
