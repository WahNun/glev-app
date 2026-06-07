-- Hybrid Cron Layer B: pg_cron in Supabase Postgres
-- ANWEISUNGEN: Im Supabase SQL Editor ausführen (NICHT als reguläre Migration — pg_cron Setup ist DB-Admin)

-- 1. Extensions enablen
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Bestehende glev-Schedules vor Re-Setup canceln (idempotent)
select cron.unschedule('glev-hypo-check') where exists (
  select 1 from cron.job where jobname = 'glev-hypo-check'
);
select cron.unschedule('glev-elevated-check') where exists (
  select 1 from cron.job where jobname = 'glev-elevated-check'
);
select cron.unschedule('glev-hyper-check') where exists (
  select 1 from cron.job where jobname = 'glev-hyper-check'
);

-- 3. Schedule jede Edge Function jede Minute
-- WICHTIG: Setze deine SUPABASE_URL hier ein (z.B. https://abc123.supabase.co)
-- Den Wert findest du in deinem Supabase Dashboard → Settings → API → Project URL

select cron.schedule(
  'glev-hypo-check',
  '* * * * *',
  $$ select net.http_post(
    url:='https://zalpwyhlijbjyspjzbvn.supabase.co/functions/v1/hypo-check',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:=('{"source":"pg_cron","ts":' || extract(epoch from now())::bigint || '}')::jsonb
  ); $$
);

select cron.schedule(
  'glev-elevated-check',
  '* * * * *',
  $$ select net.http_post(
    url:='https://zalpwyhlijbjyspjzbvn.supabase.co/functions/v1/elevated-check',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:=('{"source":"pg_cron","ts":' || extract(epoch from now())::bigint || '}')::jsonb
  ); $$
);

select cron.schedule(
  'glev-hyper-check',
  '* * * * *',
  $$ select net.http_post(
    url:='https://zalpwyhlijbjyspjzbvn.supabase.co/functions/v1/hyper-check',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:=('{"source":"pg_cron","ts":' || extract(epoch from now())::bigint || '}')::jsonb
  ); $$
);

-- 4. Verifizieren
select jobid, jobname, schedule, command from cron.job where jobname like 'glev-%';
