-- Add event_type column to sms_optout_events.
-- Distinguishes organic opt-outs ('optout') from admin-triggered relink SMS ('relink').
-- Default 'optout' keeps all existing rows consistent without a data backfill.
-- Idempotent (safe to re-run).

ALTER TABLE sms_optout_events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'optout';

COMMENT ON COLUMN sms_optout_events.event_type IS
  '''optout'' = user clicked opt-out link; ''relink'' = admin re-sent a fresh opt-out link via /api/admin/sms-relink.';
