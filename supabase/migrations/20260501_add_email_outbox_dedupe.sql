-- Idempotency / dedupe key for the email_outbox.
--
-- Stripe webhooks are retried (up to 3 days) if the receiver doesn't ack
-- with 2xx, and Stripe also occasionally re-delivers a successful event
-- after a brief outage. Without a dedupe key, every retry that reaches
-- the webhook handler enqueues another welcome email, so the buyer
-- gets the same mail twice (or more) — annoying for them and a sign of
-- a leaky exactly-once boundary.
--
-- We pin uniqueness on (template, dedupe_key) instead of the recipient
-- alone because:
--   * the *meaning* of "same logical email" depends on the template
--     (a beta-welcome and a future "your-trial-ends-soon" mail to the
--     same recipient are obviously distinct events).
--   * the dedupe key for beta-welcome is the Stripe session id — the
--     natural per-checkout identifier — which is what the webhook
--     handler now passes through.
--
-- Partial-index `where dedupe_key is not null` so callers that *don't*
-- care about dedupe (one-off operational mails, future broadcast
-- notifications, etc.) can enqueue without supplying a key. Existing
-- rows have dedupe_key = null and are not constrained.
alter table public.email_outbox
  add column if not exists dedupe_key text;

create unique index if not exists email_outbox_template_dedupe_uniq
  on public.email_outbox(template, dedupe_key)
  where dedupe_key is not null;
