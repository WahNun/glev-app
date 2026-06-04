-- Update reminder SMS to founder-voice template.
-- Uses INSERT ... ON CONFLICT to upsert: works whether the row already exists or not.
-- Welcome SMS (meta_lead_invite_sms) is NOT touched — it works correctly.

INSERT INTO message_templates (key, label, sms_text, email_subject, email_intro, updated_at)
VALUES (
  'meta_lead_reminder_sms',
  'Meta Lead — Reminder (SMS)',
  E'Lucas hier, Glev-Gründer. Du hattest dich für den 7-Tage-Test gespeichert — hier dein Link: {{link}}\n\nAbmelden: glev.app/sms-stop?t={{token}}&u={{user_id}} · Fragen: lucas@glev.app',
  NULL,
  NULL,
  now()
)
ON CONFLICT (key) DO UPDATE
  SET sms_text  = EXCLUDED.sms_text,
      updated_at = now();
