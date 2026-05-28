-- Migration: Drip-Mail-Fehler-Tracking (Task #166)
--
-- Bisher leitet das Dashboard "fehlgeschlagen" aus einer Zeit-Heuristik ab:
-- alles, was mehr als 24 h überfällig ist und noch nicht versendet wurde,
-- gilt als "failed". Der eigentliche Resend-Fehler ist nur in Server-Logs
-- sichtbar. Diese Migration fügt drei Spalten hinzu, damit der Cron den
-- echten Fehlertext persistiert und das Dashboard ihn anzeigen kann.
--
-- Spalten:
--   last_attempt_at  — Zeitstempel des letzten (fehlgeschlagenen) Versuchs.
--                      NULL = noch nie versucht (oder Erfolg, dann ist sent_at gesetzt).
--   last_error       — Letzter Fehlertext von Resend (gekürzt auf 500 Zeichen).
--                      NOT NULL = mind. ein Versuch ist fehlgeschlagen.
--                      NULL = noch nie versucht oder erfolgreich.
--   attempt_count    — Wie oft wurde versucht? Startet bei 0, wird pro
--                      Cron-Fehlversuch um 1 erhöht. Hilfreich für Triage
--                      ("ist das gerade erst passiert oder steckt das seit
--                      Tag 7?").
--
-- Bestehende Rows erhalten alle NULL-Defaults — das ist korrekt, weil wir
-- nicht wissen, ob sie je fehlgeschlagen sind (die alten Logs sind weg).

ALTER TABLE public.email_drip_schedule
  ADD COLUMN IF NOT EXISTS last_attempt_at  timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_error        text        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS attempt_count     integer     NOT NULL DEFAULT 0;

-- Index auf last_error für die "failed"-Counter-Query, die
-- `.not("last_error", "is", null)` nutzt. Partial Index auf IS NOT NULL,
-- weil fast alle Rows NULL haben werden (nur Fehler-Rows sind interessant).
CREATE INDEX IF NOT EXISTS email_drip_schedule_error_idx
  ON public.email_drip_schedule (last_error)
  WHERE last_error IS NOT NULL AND sent_at IS NULL;
