-- Update SMS templates to use {{stop_link}} placeholder instead of the raw
-- long unsubscribe URL. The short link is generated at send-time by shortenUrl().

UPDATE message_templates
SET
  sms_text = 'Willkommen bei Glev! Aktiviere deinen kostenlosen 7-Tage-Test: {{link}}

Alternativ kannst du dich auch per E-Mail anmelden – bitte prüfe ggf. auch deinen Spam-Ordner auf eine E-Mail von info@glev.app.
Abmelden: {{stop_link}}',
  updated_at = NOW()
WHERE key = 'meta_lead_invite_sms';

UPDATE message_templates
SET
  sms_text = 'Willkommen bei Glev! Aktiviere deinen kostenlosen 7-Tage-Test: {{link}}

Alternativ kannst du dich auch per E-Mail anmelden – bitte prüfe ggf. auch deinen Spam-Ordner auf eine E-Mail von info@glev.app.
Abmelden: {{stop_link}}',
  updated_at = NOW()
WHERE key = 'meta_lead_bulk_sms';

UPDATE message_templates
SET
  sms_text = 'Lucas hier, Glev-Gründer. Du hattest dich für den 7-Tage-Test gespeichert — hier dein Link: {{link}}

Abmelden: {{stop_link}} · Fragen: lucas@glev.app',
  updated_at = NOW()
WHERE key = 'meta_lead_reminder_sms';
