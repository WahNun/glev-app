-- message_templates: editable SMS + Email text templates
-- Admins can edit these via /glev-ops/emails without touching code.
-- Hardcoded fallbacks live in lib/messageTemplates.ts.

CREATE TABLE IF NOT EXISTS message_templates (
  key            TEXT PRIMARY KEY,
  label          TEXT NOT NULL DEFAULT '',
  sms_text       TEXT,           -- SMS full text, supports {{name}} and {{link}} placeholders
  email_subject  TEXT,           -- Email subject line
  email_intro    TEXT,           -- Email main intro paragraph ({{name}} placeholder)
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Seed with the current hardcoded defaults so existing behaviour is preserved.
-- ON CONFLICT DO NOTHING: re-running is a no-op.
INSERT INTO message_templates (key, label, sms_text, email_subject, email_intro) VALUES

('meta_lead_invite_sms',
 'Meta Lead — Einladung (SMS)',
 E'Willkommen bei Glev! Aktiviere deinen kostenlosen 7-Tage-Test: {{link}}\n\nAlternativ kannst du dich auch per E-Mail anmelden – bitte prüfe ggf. auch deinen Spam-Ordner auf eine E-Mail von info@glev.app.',
 NULL, NULL),

('meta_lead_bulk_sms',
 'Meta Lead — Bulk-SMS',
 E'Willkommen bei Glev! Aktiviere deinen kostenlosen 7-Tage-Test: {{link}}\n\nAlternativ kannst du dich auch per E-Mail anmelden – bitte prüfe ggf. auch deinen Spam-Ordner auf eine E-Mail von info@glev.app.',
 NULL, NULL),

('meta_lead_reminder_sms',
 'Meta Lead — Reminder (SMS)',
 E'Hast du Glev noch nicht ausprobiert? Als T1D-Nutzer:in hilft dir Glev dabei, deine Insulindosierung besser einzuschätzen. Dein kostenloser 7-Tage-Test: {{link}}\n\nFragen? Antworte einfach auf diese SMS.',
 NULL, NULL),

('meta_lead_reminder_email',
 'Meta Lead — Reminder (Email)',
 NULL,
 'Dein Glev-Test wartet noch auf dich 🔔',
 'du hattest Interesse an Glev – der App die dir hilft, deine Insulindosierung besser einzuschätzen. Dein kostenloser 7-Tage-Test ist noch nicht aktiviert.')

ON CONFLICT (key) DO NOTHING;

-- Add owner_email to short_links so click-tracking can be joined per-lead in the CRM.
-- Wrapped in a DO block: if short_links doesn't exist yet (created in a later migration),
-- this is a no-op and the column will be added when that migration runs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'short_links'
  ) THEN
    ALTER TABLE short_links ADD COLUMN IF NOT EXISTS owner_email TEXT;
  END IF;
END $$;
