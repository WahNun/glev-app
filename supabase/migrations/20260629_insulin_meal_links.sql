-- insulin_meal_links: M:N junction table linking bolus logs to multiple meals.
-- DOCUMENTATION ONLY — table already applied to production.
--
-- A single bolus can now be associated with more than one meal (e.g. a large
-- lunch logged as two separate meal entries). related_entry_id on insulin_logs
-- is kept as the primary FK for backward compatibility and engine ICR pairing.
-- insulin_meal_links extends the relationship to N meals without migrating
-- the existing 1:1 column.
--
-- Applied: 2026-06-29

create table if not exists insulin_meal_links (
  id              uuid primary key default gen_random_uuid(),
  insulin_log_id  uuid not null references insulin_logs(id) on delete cascade,
  meal_id         uuid not null references meal_logs(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (insulin_log_id, meal_id)
);

alter table insulin_meal_links enable row level security;

create policy "Users manage own insulin_meal_links"
  on insulin_meal_links
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
