create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz not null default now(),

  -- Quelle des Feedbacks
  source text not null check (source in ('chat_ai', 'support_form', 'support_email')),

  -- Strukturierte Felder (von AI gesammelt)
  what_noticed text not null,
  where_noticed text,
  what_broken text,
  what_wished text,

  -- Klassifikation
  category text not null check (category in ('bug', 'feature_request', 'complaint', 'praise', 'question', 'other')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),

  -- Roh-Daten
  free_text text not null,
  ai_summary text,
  chat_thread_id uuid,

  -- Auto-Kontext
  screen_context text,
  app_version text,
  platform text check (platform in ('ios', 'android', 'web')),
  device_info jsonb,

  -- Admin-Workflow
  status text not null default 'new' check (status in ('new', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate')),
  admin_notes text,
  admin_assigned_to uuid references auth.users(id) on delete set null,
  triaged_at timestamptz,
  resolved_at timestamptz
);

alter table public.user_feedback enable row level security;

-- User können nur eigenes Feedback INSERT (kein SELECT — Privacy)
create policy "users insert own feedback" on public.user_feedback
  for insert with check (auth.uid() = user_id);

-- Admin kann alles
create policy "admin all feedback" on public.user_feedback
  for all using (
    auth.uid() in (select id from auth.users where email in ('lucas@wahnon-connect.com', 'lucas@glev.app'))
  );

create index idx_user_feedback_user_id on public.user_feedback(user_id);
create index idx_user_feedback_status on public.user_feedback(status);
create index idx_user_feedback_category on public.user_feedback(category);
create index idx_user_feedback_created_at on public.user_feedback(created_at desc);
