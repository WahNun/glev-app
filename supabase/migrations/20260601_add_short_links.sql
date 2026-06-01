-- Link-Shortener für SMS: speichert Kurz-Code → echte URL
-- Einträge laufen nach 30 Tagen automatisch ab (für Invite-Links ausreichend)
CREATE TABLE IF NOT EXISTS public.short_links (
  code       TEXT        PRIMARY KEY,
  url        TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;

-- Nur Service-Role darf lesen/schreiben (kein Nutzer-Zugriff nötig)
CREATE POLICY "service role only" ON public.short_links
  USING (false);
