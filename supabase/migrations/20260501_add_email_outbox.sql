-- Email outbox — durable queue so Stripe-webhook (and any future) email
-- deliveries survive Resend hiccups, transient network errors, or the
-- server crashing between Stripe-Ack and resend.emails.send().
--
-- Why this table is server-only:
--   The `payload` column intentionally contains rendered HTML / template
--   inputs (recipient name, Stripe session id, app URL). Nothing here is
--   user-facing, all writes/reads happen via SUPABASE_SERVICE_ROLE_KEY
--   from the webhook + cron worker. RLS therefore stays disabled — no
--   anon/auth role should ever touch this table directly.
--
-- Lifecycle:
--   pending  → freshly enqueued or "to be retried", picked up by the
--              cron worker when next_attempt_at <= now().
--   sending  → claimed by the worker, prevents a parallel cron run from
--              double-sending the same row.
--   sent     → Resend accepted the message; message_id stored for grep.
--   dead     → MAX_ATTEMPTS exhausted, no further retries. Logged loud
--              so the operator gets paged.
create table if not exists public.email_outbox (
  id               uuid default gen_random_uuid() primary key,
  recipient        text not null,
  template         text not null,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'pending'
                     check (status in ('pending', 'sending', 'sent', 'dead')),
  attempts         int not null default 0,
  last_error       text,
  last_attempt_at  timestamptz,
  next_attempt_at  timestamptz not null default now(),
  message_id       text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);

-- Worker query: "pending rows whose retry window is up, oldest first".
create index if not exists email_outbox_due_idx
  on public.email_outbox(next_attempt_at)
  where status = 'pending';

-- Operator queries: "show me the dead ones" / "is anything still pending?".
create index if not exists email_outbox_status_idx
  on public.email_outbox(status);
