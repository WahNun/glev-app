-- Lead-Qualifizierung: Status und Kommentar für manuelle CRM-Annotation.
-- Kein Enum, damit neue Status-Werte später ohne Migration hinzugefügt werden können.
ALTER TABLE public.meta_leads ADD COLUMN IF NOT EXISTS lead_status  text;
ALTER TABLE public.meta_leads ADD COLUMN IF NOT EXISTS lead_comment text;

CREATE INDEX IF NOT EXISTS meta_leads_lead_status_idx ON public.meta_leads (lead_status);
