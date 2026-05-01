-- Doctor-friendly free-text note that travels alongside the user's
-- "last appointment" date (Task #92). The date alone (Task #75) is a
-- context-free number; a short note ("Dr. Müller, A1c 7.2", clinic
-- name, etc.) turns the saved date into self-explanatory metadata for
-- the Export PDF cover. Nullable: an empty / missing note simply
-- omits the meta line on the cover and leaves the input blank in
-- Settings. Idempotent.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS last_appointment_note text;

COMMENT ON COLUMN user_settings.last_appointment_note
  IS 'Optional short free-text note attached to the user''s last appointment date (e.g. doctor name, clinic, key result). Surfaced on the Export PDF cover next to the date.';
