-- Add stripe_session_id to pro_subscriptions so support tooling and
-- backfill scripts can resolve a Pro row back to its originating Stripe
-- Checkout Session without a Stripe API roundtrip.
--
-- Mirrors `beta_reservations.stripe_session_id` + `beta_reservations_session_idx`
-- so the two buyer tables expose the same shape of Stripe identifiers.
--
-- Nullable: historic rows (from before the Pro webhook started writing this
-- column) intentionally stay NULL. The backfill script in
-- `scripts/backfill-buyer-names.mjs` can now stamp them lazily.
alter table public.pro_subscriptions
  add column if not exists stripe_session_id text;

create index if not exists pro_subscriptions_session_idx
  on public.pro_subscriptions(stripe_session_id);
