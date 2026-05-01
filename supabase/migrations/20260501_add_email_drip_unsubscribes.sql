-- Drip-Email-Abmeldungen — globale Sperrliste für die Onboarding-Drip-
-- Sequenz (Tag 7/14/30, siehe email_drip_schedule).
--
-- Warum eine eigene Tabelle (statt einer Spalte auf email_drip_schedule)?
--   - Eine Abmeldung gilt pro Mail-Adresse, nicht pro eingeplantem
--     Termin. Würden wir nur die offenen Schedule-Rows als "skipped"
--     markieren, käme bei einem späteren zweiten Kauf (z. B. erst Beta,
--     dann Pro) wieder eine frische Drip-Serie rein, weil
--     scheduleDripEmails() neue Rows einplanen würde — die Abmeldung
--     muss also außerhalb der Schedule-Tabelle leben.
--   - Sie ist außerdem unser Audit-Log: wann hat sich wer aus welcher
--     Quelle abgemeldet ("link" = Footer in einer Drip-Mail; weitere
--     Quellen wie "support" oder "manual" sind möglich).
--   - Die Tabelle bleibt klein (eine Row pro Empfänger:in, kein Wachstum
--     mit der Zeit), entsprechend günstig im Index.
--
-- Server-only: gleiche Begründung wie email_drip_schedule — RLS aktiv,
-- keine Policies, nur die Service-Role schreibt/liest.
create table if not exists public.email_drip_unsubscribes (
  email           text primary key,
  unsubscribed_at timestamptz not null default now(),
  source          text not null default 'link'
);

alter table public.email_drip_unsubscribes enable row level security;
