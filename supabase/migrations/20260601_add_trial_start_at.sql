-- Trial-Start-Zeitpunkt für Meta-Lead-User (und alle Trial-User).
-- Vorher: trial_end_at wurde beim Webhook-Eingang gesetzt (sofort).
-- Neu: trial_start_at + trial_end_at werden erst beim ersten echten
-- Klick auf den Confirm-Button gesetzt (POST /api/auth/activate-trial).
-- Beim Webhook-Eingang bleiben beide Felder NULL.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_start_at TIMESTAMPTZ;
