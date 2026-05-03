-- email_drip_schedule.locale — language for the three Drip-Mails.
-- The Beta/Pro Stripe webhooks now stamp this from `session.locale`
-- ('de' | 'en'), and the cron worker picks the matching renderer. Default
-- 'de' so any rows already scheduled before this column existed continue
-- to send in German — which is the language they would have sent in
-- anyway, since EN templates didn't exist yet.
alter table public.email_drip_schedule
  add column if not exists locale text not null default 'de'
    check (locale in ('de', 'en'));
