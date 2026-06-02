-- Migration: ai_agent_prompt_versions table
-- Companion audit-log for ai_agent_prompts.
-- Every save (including resets) inserts a copy here so admins can
-- review history, compare versions, and restore any past prompt.

create table if not exists public.ai_agent_prompt_versions (
  id          uuid primary key default gen_random_uuid(),
  prompt_key  text not null,               -- mirrors ai_agent_prompts.key
  version     integer not null,            -- version number at time of save
  prompt_text text not null,
  saved_by    text,                        -- admin email
  saved_at    timestamptz not null default now(),
  is_reset    boolean not null default false -- true when this was a "reset to default"
);

-- Index for fast lookup of history for a given key, newest-first.
create index if not exists ai_agent_prompt_versions_key_version_idx
  on public.ai_agent_prompt_versions (prompt_key, version desc);

-- RLS: enable but allow nothing via anon/authenticated.
-- Only the service-role client (admin panel server actions) can read/write.
alter table public.ai_agent_prompt_versions enable row level security;
