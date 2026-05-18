-- Erweitere die `tier`-CHECK-Constraint von email_drip_schedule um den
-- neuen Glev+-Tier ('plus'). Vorher: ('beta', 'pro') — ein
-- scheduleDripEmails(..., tier: 'plus', ...) Call würde mit
-- PostgREST 23514 (check_violation) abgebrochen, der scheduler swallow-t
-- den Fehler nur, womit die Drip-Sequenz für Plus-Käufer:innen leer
-- bliebe.
--
-- Idempotent: DROP IF EXISTS + ADD. Re-runs sind safe.

ALTER TABLE public.email_drip_schedule
  DROP CONSTRAINT IF EXISTS email_drip_schedule_tier_check;

ALTER TABLE public.email_drip_schedule
  ADD CONSTRAINT email_drip_schedule_tier_check
  CHECK (tier IN ('beta', 'pro', 'plus'));
