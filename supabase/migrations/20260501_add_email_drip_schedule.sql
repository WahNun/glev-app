-- Drip-Email-Sequenz — eigene Queue für die drei Onboarding-Mails an
-- Tag 7 (Insights), Tag 14 (Feedback), Tag 30 (Trustpilot), die nach
-- der Welcome-Mail an neue Beta- und Pro-Käufer:innen rausgehen.
--
-- Warum eine separate Tabelle (statt der Outbox)?
--   Die Outbox (email_outbox) ist auf "muss in den nächsten Sekunden
--   raus" optimiert — Webhook-getrieben, mit Retry, Reclaim, Dead
--   Letter, weil Stripe nur einmal feuert. Drip-Mails sind das
--   genaue Gegenteil: sie sollen erst in 7/14/30 Tagen los, ein
--   verpasster Cron-Tick schadet niemandem, der nächste 09:00-UTC-Lauf
--   räumt auf. Würden sie durch die Outbox laufen, müsste die
--   Outbox-Cron-Logik die Drip-Termine entweder ignorieren (also
--   `next_attempt_at` jenseits von "in 1-2 Min wieder probieren"
--   tolerieren) oder alle 2 Min Tausende Drip-Rows abarbeiten —
--   beides verwässert die Outbox-Garantien.
--
-- Server-only:
--   Die Service-Role schreibt/liest, RLS bleibt aktiv, aber es gibt
--   keine Policies. Anon/auth dürfen nichts sehen.
create table if not exists public.email_drip_schedule (
  id            uuid default gen_random_uuid() primary key,
  email         text not null,
  first_name    text,
  tier          text not null check (tier in ('beta', 'pro')),
  email_type    text not null
                  check (email_type in ('day7_insights', 'day14_feedback', 'day30_trustpilot')),
  scheduled_at  timestamptz not null,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- Eindeutigkeit pro Empfänger und Mail-Typ. Verhindert, dass ein
-- doppelt zugestellter Stripe-Webhook drei zusätzliche Drip-Termine
-- pro Käufer:in einplant. Der scheduleDripEmails()-Helper nutzt das
-- via `upsert({ ignoreDuplicates: true, onConflict: "email,email_type" })`.
create unique index if not exists email_drip_schedule_recipient_uniq
  on public.email_drip_schedule(email, email_type);

-- Worker-Query: "alle fälligen, noch nicht versendeten Termine, älteste
-- zuerst". Partial Index, weil sent_at IS NULL nach kurzer Zeit nur noch
-- einen Bruchteil der Tabelle abdeckt — verhindert, dass das Cron-SELECT
-- mit der Tabelle wächst.
create index if not exists email_drip_schedule_pending_idx
  on public.email_drip_schedule(scheduled_at)
  where sent_at is null;

alter table public.email_drip_schedule enable row level security;
