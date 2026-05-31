-- Meta Lead Ads: empfängt Leads via Webhook und speichert sie strukturiert.
-- leadgen_id dient zur Deduplizierung (Meta kann Webhooks mehrfach senden).

create table if not exists public.meta_leads (
  id              uuid primary key default gen_random_uuid(),
  leadgen_id      text not null,
  page_id         text,
  form_id         text,
  ad_id           text,
  ad_name         text,
  adset_id        text,
  adset_name      text,
  campaign_id     text,
  campaign_name   text,
  platform        text,
  full_name       text,
  first_name      text,
  last_name       text,
  email           text,
  phone           text,
  is_test         boolean default false,
  fields          jsonb,
  field_data      jsonb,
  raw             jsonb,
  created_time    timestamptz,
  received_at     timestamptz not null default now(),
  constraint meta_leads_leadgen_id_key unique (leadgen_id)
);

create index if not exists meta_leads_email_idx      on public.meta_leads (email);
create index if not exists meta_leads_received_at_idx on public.meta_leads (received_at desc);
create index if not exists meta_leads_page_id_idx    on public.meta_leads (page_id);

alter table public.meta_leads enable row level security;

-- Service Role (Edge Function / Next.js API) schreibt, kein öffentlicher Lese-Zugriff.
-- Für das Admin-Dashboard bei Bedarf auskommentieren und anpassen:
-- create policy "Admin lesen" on public.meta_leads
--   for select using (auth.role() = 'authenticated');
