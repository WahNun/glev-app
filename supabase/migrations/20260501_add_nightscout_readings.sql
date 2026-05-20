create table if not exists nightscout_readings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  recorded_at   timestamptz not null,
  value_mgdl    integer not null,
  direction     text,
  source        text not null default 'nightscout',
  created_at    timestamptz not null default now(),
  unique (user_id, recorded_at)
);

alter table nightscout_readings enable row level security;

create policy "Users can read own nightscout readings"
  on nightscout_readings for select
  using (auth.uid() = user_id);

create policy "Service role can insert nightscout readings"
  on nightscout_readings for insert
  with check (true);

create index if not exists nightscout_readings_user_time
  on nightscout_readings (user_id, recorded_at desc);
