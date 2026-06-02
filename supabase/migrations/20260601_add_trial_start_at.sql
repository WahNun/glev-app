-- Trial-Start-Zeitpunkt für Meta-Lead-User (und alle Trial-User).
-- Vorher: trial_end_at wurde beim Webhook-Eingang gesetzt (sofort).
-- Neu: trial_start_at + trial_end_at werden erst beim ersten echten
-- Klick auf den Confirm-Button gesetzt (POST /api/auth/activate-trial).
-- Beim Webhook-Eingang bleiben beide Felder NULL.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_start_at TIMESTAMPTZ;

-- Backfill für bestehende User mit trial_start_at = NULL aber
-- trial_end_at IS NOT NULL (vor Migration provisionierte User).
-- NICHT automatisch ausgeführt — bei Bedarf manuell im Supabase
-- SQL-Editor einfügen:
--
-- UPDATE profiles
-- SET trial_start_at = trial_end_at - INTERVAL '7 days'
-- WHERE trial_start_at IS NULL
--   AND trial_end_at IS NOT NULL;
