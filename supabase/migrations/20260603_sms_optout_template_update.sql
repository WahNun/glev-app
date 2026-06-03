-- Update all marketing SMS templates to include the UWG/TKG-required
-- unsubscribe line with {{token}} and {{user_id}} placeholders.
--
-- Background: 20260603_message_templates.sql seeded these rows with
-- ON CONFLICT DO NOTHING, so earlier versions without the opt-out line
-- were never overwritten. This migration updates all three send paths.
--
-- {{token}} and {{user_id}} are substituted at send-time by renderSms().

UPDATE message_templates
SET
  sms_text   = E'Willkommen bei Glev! Aktiviere deinen kostenlosen 7-Tage-Test: {{link}}\n\nAlternativ kannst du dich auch per E-Mail anmelden \x96 bitte pr\xfcfe ggf. auch deinen Spam-Ordner auf eine E-Mail von info@glev.app.\nAbmelden: https://glev.app/sms-stop?t={{token}}&u={{user_id}}',
  updated_at = now()
WHERE key = 'meta_lead_invite_sms';

UPDATE message_templates
SET
  sms_text   = E'Willkommen bei Glev! Aktiviere deinen kostenlosen 7-Tage-Test: {{link}}\n\nAlternativ kannst du dich auch per E-Mail anmelden \x96 bitte pr\xfcfe ggf. auch deinen Spam-Ordner auf eine E-Mail von info@glev.app.\nAbmelden: https://glev.app/sms-stop?t={{token}}&u={{user_id}}',
  updated_at = now()
WHERE key = 'meta_lead_bulk_sms';

UPDATE message_templates
SET
  sms_text   = E'Hast du Glev noch nicht ausprobiert? Als T1D-Nutzer:in hilft dir Glev dabei, deine Insulindosierung besser einzusch\xe4tzen. Dein kostenloser 7-Tage-Test: {{link}}\n\nAbmelden: https://glev.app/sms-stop?t={{token}}&u={{user_id}} \xb7 Fragen: lucas@glev.app',
  updated_at = now()
WHERE key = 'meta_lead_reminder_sms';
