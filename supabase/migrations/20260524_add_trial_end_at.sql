-- Free-Trial: Ablaufdatum für den 7-Tage-Test-Account.
-- NULL  = kein Trial (reguläre kostenlose Nutzer / Paid-User)
-- != NULL = Trial-User; Modal erscheint wenn < NOW() und kein aktives Abo.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_end_at TIMESTAMPTZ;
