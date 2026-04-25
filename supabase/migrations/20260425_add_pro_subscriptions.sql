-- Pro membership subscriptions for the /pro landing page.
-- Written exclusively by server routes using SUPABASE_SERVICE_ROLE_KEY,
-- so RLS is intentionally disabled on this table.
create table if not exists public.pro_subscriptions (
  id                       uuid default gen_random_uuid() primary key,
  email                    text unique not null,
  stripe_customer_id       text,
  stripe_subscription_id   text,
  stripe_price_id          text,
  status                   text default 'pending'
                             check (status in ('pending', 'trialing', 'active', 'past_due', 'cancelled')),
  trial_ends_at            timestamptz,
  current_period_end       timestamptz,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

create index if not exists pro_subscriptions_status_idx
  on public.pro_subscriptions(status);

create index if not exists pro_subscriptions_email_idx
  on public.pro_subscriptions(email);

create index if not exists pro_subscriptions_subscription_idx
  on public.pro_subscriptions(stripe_subscription_id);

-- Auto-bump updated_at on every UPDATE so we can detect the latest webhook write.
create or replace function public.pro_subscriptions_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pro_subscriptions_set_updated_at on public.pro_subscriptions;
create trigger pro_subscriptions_set_updated_at
  before update on public.pro_subscriptions
  for each row execute function public.pro_subscriptions_set_updated_at();
