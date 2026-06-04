-- stripe_processed_events: idempotency table for Stripe webhook deliveries.
--
-- Each row represents one successfully processed Stripe event. Duplicate
-- deliveries (Stripe retries the same event_id on non-2xx or network error)
-- are detected via the PRIMARY KEY constraint and ACKed 200 without
-- re-processing the business logic.
--
-- Primary key is (event_id, endpoint) so the same Stripe event can be
-- received by multiple independent webhook endpoints (e.g. /api/pro/webhook
-- and /api/plus/webhook) without false-positive deduplication.
--
-- Written exclusively by server routes via SUPABASE_SERVICE_ROLE_KEY.
-- RLS disabled intentionally — same pattern as pro_subscriptions.

create table if not exists public.stripe_processed_events (
  event_id     text        not null,
  endpoint     text        not null default 'unknown',
  processed_at timestamptz not null default now(),
  primary key (event_id, endpoint)
);

-- Admin tooling: list recent events per endpoint sorted by time
create index if not exists stripe_processed_events_endpoint_idx
  on public.stripe_processed_events (endpoint, processed_at desc);
