-- Beta seat reservations for the pre-launch /beta page.
-- Written exclusively by server routes using SUPABASE_SERVICE_ROLE_KEY,
-- so RLS is intentionally disabled on this table.
create table if not exists public.beta_reservations (
  id                  uuid default gen_random_uuid() primary key,
  email               text unique not null,
  stripe_session_id   text,
  stripe_customer_id  text,
  amount_cents        int default 1900,
  currency            text default 'eur',
  status              text default 'pending'
                        check (status in ('pending', 'paid', 'refunded', 'cancelled')),
  created_at          timestamptz default now(),
  fulfilled_at        timestamptz
);

create index if not exists beta_reservations_status_idx
  on public.beta_reservations(status);

create index if not exists beta_reservations_session_idx
  on public.beta_reservations(stripe_session_id);
