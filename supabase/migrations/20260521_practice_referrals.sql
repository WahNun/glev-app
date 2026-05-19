-- Praxis-Referral-Links (Task: Partnerpraxen-Empfehlungslinks)
-- Jede Praxis bekommt einen eindeutigen Slug, z.B. "kopenick".
-- Die Landing-Page /praxis/:slug liest diesen Row per Service-Role.
-- Writes nur über Admin-Panel (service role, bypasses RLS).

create table if not exists practice_referrals (
  id           uuid        primary key default gen_random_uuid(),
  slug         text        not null unique,
  name         text        not null,
  greeting_text text,
  active       boolean     not null default true,
  created_at   timestamptz not null default now()
);

-- Enable RLS; public SELECT is allowed so anon reads also work if needed.
-- Service-role (admin panel, landing page SSR) bypasses RLS entirely.
alter table practice_referrals enable row level security;

create policy "Public can read active practices"
  on practice_referrals for select
  using (active = true);
