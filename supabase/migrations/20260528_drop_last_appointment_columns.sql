-- Drop the legacy single-appointment columns from user_settings (Task #113).
--
-- Background:
--   • 20260430_add_user_settings_last_appointment.sql added
--     `last_appointment_at date` to carry the first-ever appointment date.
--   • 20260501_add_user_settings_last_appointment_note.sql added
--     `last_appointment_note text` alongside it.
--   • 20260501_add_appointments.sql migrated all callers to the new
--     `appointments` table and backfilled existing rows, leaving both
--     legacy columns in place as a safety net for one release cycle.
--   • Task #113 confirms: no code path reads either column directly any
--     more. `fetchLatestAppointmentDate()` and `fetchAppointments()` in
--     `lib/appointments.ts` are the sole read paths; `fetchLastAppointment`
--     in `lib/userSettings.ts` was removed in this task. It is now safe
--     to drop both columns.
--
-- Idempotent: each DROP uses IF EXISTS so re-running the migration via
-- scripts/apply-migration.mjs is safe.

ALTER TABLE user_settings
  DROP COLUMN IF EXISTS last_appointment_at,
  DROP COLUMN IF EXISTS last_appointment_note;

COMMENT ON TABLE user_settings IS
  'Per-user insulin + macro settings. last_appointment_at and '
  'last_appointment_note were removed (Task #113); appointment data '
  'lives exclusively in the `appointments` table since Task #93.';
