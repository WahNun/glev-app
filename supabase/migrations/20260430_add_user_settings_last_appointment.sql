-- Add a "last appointment" date to user_settings so the Export panel can
-- offer a one-click "since my last visit" preset (Task #75). The column
-- is nullable: a missing value means the user hasn't recorded one, in
-- which case the export panel hides the chip entirely. Idempotent.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS last_appointment_at date;

COMMENT ON COLUMN user_settings.last_appointment_at
  IS 'Date of the user''s most recent doctor appointment. Drives the "Seit letztem Arzttermin" preset chip in the Export panel.';
