-- Per-user list of doctor appointments. Replaces the single
-- `user_settings.last_appointment_at` field with a proper list so the
-- Export panel can offer windows like "since the visit before last"
-- or "between Jan and Apr visits" instead of being limited to "since
-- the most recent visit". The settings UI becomes an add/edit/delete
-- list; the export panel keeps its compact single-chip default and
-- exposes older entries through an optional "..." menu (Task #93).
--
-- Schema notes:
--   • `appointment_at` is a `date` (not timestamptz) — the user picks
--     a calendar day, no time-of-day or timezone meaning.
--   • `note` is optional free-text the user can use to label a visit
--     ("Endo Q1", "Diabetologist follow-up", etc.) so the dropdown of
--     older entries in the Export panel is scannable.
--   • Composite (user_id, appointment_at DESC) index because every
--     read path orders by date desc — both the Settings list view and
--     the Export panel's "latest" lookup.
--
-- Backfill: copy each user's existing `user_settings.last_appointment_at`
-- into a corresponding `appointments` row (with no note) so existing
-- users keep their saved date and the Export chip continues to work
-- after this migration ships. We leave `last_appointment_at` in place
-- for now — `lib/userSettings.ts.fetchLastAppointment()` becomes a
-- derived helper that reads from the new table — and a follow-up task
-- can drop the column once no code path reads it directly.
--
-- Idempotent (safe to re-run via scripts/apply-migration.mjs).

CREATE TABLE IF NOT EXISTS appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL,
  appointment_at  date NOT NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointments_user_appt_idx
  ON appointments (user_id, appointment_at DESC);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "appointments_select_own" ON appointments;
CREATE POLICY "appointments_select_own"
  ON appointments FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "appointments_insert_own" ON appointments;
CREATE POLICY "appointments_insert_own"
  ON appointments FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "appointments_update_own" ON appointments;
CREATE POLICY "appointments_update_own"
  ON appointments FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "appointments_delete_own" ON appointments;
CREATE POLICY "appointments_delete_own"
  ON appointments FOR DELETE
  USING (auth.uid()::text = user_id);

-- Auto-bump updated_at on every change so callers don't need to
-- maintain it manually (matches the user_settings convention).
CREATE OR REPLACE FUNCTION set_appointments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_updated_at_tg ON appointments;
CREATE TRIGGER appointments_updated_at_tg
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_appointments_updated_at();

-- Backfill: bring the existing single-date value into the new list so
-- existing users don't lose their saved appointment after this ships.
-- The `NOT EXISTS` guard makes the backfill idempotent — re-running
-- the migration won't duplicate the row.
--
-- Also carry over `last_appointment_note` when the column exists
-- (added by Task #92's migration, which lands ahead of this one once
-- the rebase merges) so the doctor note attached to the legacy single
-- appointment doesn't silently disappear from the user's record. The
-- DO block + information_schema check keeps the migration safe against
-- environments where Task #92's column hasn't been applied yet.
DO $$
DECLARE
  has_note_col boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_settings'
      AND column_name = 'last_appointment_note'
  ) INTO has_note_col;

  IF has_note_col THEN
    INSERT INTO appointments (user_id, appointment_at, note)
    SELECT us.user_id, us.last_appointment_at, us.last_appointment_note
    FROM user_settings us
    WHERE us.last_appointment_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.user_id = us.user_id
          AND a.appointment_at = us.last_appointment_at
      );
  ELSE
    INSERT INTO appointments (user_id, appointment_at)
    SELECT us.user_id, us.last_appointment_at
    FROM user_settings us
    WHERE us.last_appointment_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.user_id = us.user_id
          AND a.appointment_at = us.last_appointment_at
      );
  END IF;
END $$;

COMMENT ON TABLE appointments IS
  'Per-user doctor appointment dates (Task #93). Drives the Export panel''s "Seit letztem Arzttermin" chip — the most recent entry by default, with an optional dropdown for older entries.';
