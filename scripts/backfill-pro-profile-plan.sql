-- Task #295 — One-shot backfill: copy Pro membership state out of
-- `pro_subscriptions` into `profiles.plan` so the rest of the app can read
-- a single source of truth. Idempotent: re-running is safe (only flips
-- profiles.plan when it's currently NULL or non-"pro").
--
-- Run once in the Supabase SQL Editor (production project) AFTER the
-- updated /api/pro/webhook is deployed. Order matters because new
-- subscription events from this point forward will keep profiles.plan in
-- sync automatically; the backfill only repairs the historical 12 trial
-- users who were created before the webhook learned about profiles.plan.
--
-- Audit query (run before AND after to verify):
--
--   select
--     p.user_id, u.email, ps.status as pro_status, p.plan as profile_plan
--   from public.pro_subscriptions ps
--   join auth.users u on lower(u.email) = lower(ps.email)
--   join public.profiles p on p.user_id = u.id
--   where ps.status in ('trialing', 'active', 'past_due')
--   order by ps.updated_at desc;
--
-- After the backfill, every row above must have profile_plan = 'pro'.

begin;

-- 1. Promote: any auth user whose pro_subscription is live → profiles.plan='pro'.
update public.profiles p
set    plan = 'pro'
from   public.pro_subscriptions ps
join   auth.users u on lower(u.email) = lower(ps.email)
where  p.user_id = u.id
  and  ps.status in ('trialing', 'active', 'past_due')
  and  (p.plan is distinct from 'pro');

-- 2. Demote: any auth user whose ONLY pro_subscription is terminal
--    (cancelled / pending) but whose profile still says 'pro' → reset to NULL.
--    Skips users who also have a live subscription elsewhere (shouldn't
--    happen — email is unique on pro_subscriptions — but the EXISTS guard
--    keeps the statement composable in case the constraint is ever relaxed).
update public.profiles p
set    plan = null
from   auth.users u
join   public.pro_subscriptions ps on lower(ps.email) = lower(u.email)
where  p.user_id = u.id
  and  p.plan = 'pro'
  and  ps.status in ('cancelled', 'pending')
  and  not exists (
         select 1 from public.pro_subscriptions ps2
         where  lower(ps2.email) = lower(u.email)
           and  ps2.status in ('trialing', 'active', 'past_due')
       );

commit;
