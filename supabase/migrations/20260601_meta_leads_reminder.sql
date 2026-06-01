-- Tracking für automatische Reminder-SMS nach 24h ohne Trial-Aktivierung.
ALTER TABLE public.meta_leads ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS meta_leads_reminder_sent_at_idx ON public.meta_leads (reminder_sent_at);
