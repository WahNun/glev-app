-- Add `currency` and `country` to pro_subscriptions and `country` to
-- beta_reservations so the admin user list can filter by buyer currency
-- (EUR / USD) and geolocation (Stripe customer billing country).
--
-- Stripe gives us both fields on every Checkout Session:
--   * session.currency                              → 3-letter ISO 4217 (eur/usd/…)
--   * session.customer_details.address.country      → 2-letter ISO 3166-1 alpha-2 (DE/US/…)
--
-- We store them lower-/upper-case as Stripe returns them (currency=lower,
-- country=upper) and never normalise — the filter UI does the comparison
-- case-insensitively.
--
-- All three columns are nullable: pre-migration rows have no Stripe data
-- to backfill from until the operator runs the "Backfill" button on
-- /admin/users.

alter table public.pro_subscriptions
  add column if not exists currency text,
  add column if not exists country  text;

alter table public.beta_reservations
  add column if not exists country  text;

-- Indexes for the admin filter — small tables (<10k rows expected for years)
-- but the dropdown query lists every distinct country and we want it
-- snappy even after growth.
create index if not exists pro_subscriptions_currency_idx
  on public.pro_subscriptions(currency);
create index if not exists pro_subscriptions_country_idx
  on public.pro_subscriptions(country);
create index if not exists beta_reservations_country_idx
  on public.beta_reservations(country);
