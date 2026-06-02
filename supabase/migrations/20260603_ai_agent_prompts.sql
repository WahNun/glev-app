-- Migration: ai_agent_prompts table
-- Stores editable system prompts for the Glev AI chat assistant.
-- The admin panel reads/writes via service-role; no direct user access.

create table if not exists public.ai_agent_prompts (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,          -- e.g. 'glev_ai_default'
  title       text not null default '',
  prompt_text text not null default '',
  is_active   boolean not null default true,
  version     integer not null default 1,
  updated_by  text,                          -- admin email
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS: enable but allow nothing via anon/authenticated.
-- Only the service-role client (admin panel server actions) can read/write.
alter table public.ai_agent_prompts enable row level security;

-- No policies → only service-role bypasses RLS by default.
-- (Supabase service-role always bypasses RLS.)
