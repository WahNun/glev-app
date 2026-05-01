-- Capture the buyer's full name (collected via Stripe Checkout `custom_fields`
-- with key `full_name`, made mandatory in task #68) on the rows the webhook
-- writes. Both tables are written exclusively by server routes using the
-- service-role key, so no RLS changes are required.
--
-- Nullable on purpose: rows created before this column existed (or by
-- subscription flows where the webhook fires before we can read the field)
-- must remain valid. Backfill is intentionally out of scope (task #70).

alter table public.beta_reservations
  add column if not exists full_name text;

alter table public.pro_subscriptions
  add column if not exists full_name text;
