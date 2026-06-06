-- Retention-flow cancellation feedback from users cancelling their Pro subscription.
-- Written by POST /api/me/subscription/cancel when the user completes Step 3
-- of the retention flow. Reasons are stored as a text array; custom_text is
-- optional free-text. Service-role inserts on behalf of the user (server route);
-- the user can read their own rows via RLS.
create table if not exists public.cancellation_feedback (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  reasons     text[]      not null default '{}',
  custom_text text,
  created_at  timestamptz default now()
);

alter table public.cancellation_feedback enable row level security;

create policy "user can insert own cancellation feedback"
  on public.cancellation_feedback for insert
  with check (auth.uid() = user_id);

create policy "user can read own cancellation feedback"
  on public.cancellation_feedback for select
  using (auth.uid() = user_id);

create index if not exists cancellation_feedback_user_idx
  on public.cancellation_feedback(user_id);
