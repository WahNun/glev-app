-- Per-symptom severity refactor.
--
-- Replaces the legacy single `severity smallint` column (one value
-- shared by every symptom in a log entry) with a `severities jsonb`
-- map keyed by symptom token, e.g. {"headache": 4, "brain_fog": 2}.
-- Each value must be an integer 1..5; the keys are expected to mirror
-- `symptom_types` (validated in the app layer — kept loose in SQL so a
-- vocabulary rename doesn't brick existing rows).
--
-- Migration strategy:
--   1. Add the new column (nullable so we can backfill).
--   2. Backfill every existing row by copying the old `severity` value
--      into each symptom token in `symptom_types`.
--   3. Lock the column (NOT NULL + DEFAULT '{}' for future rows).
--   4. Add a CHECK constraint that every value is an int 1..5.
--   5. Drop the legacy `severity` column + its old constraint.
--
-- Idempotent: safe to re-run. Each step checks current schema state
-- before mutating so a partial previous run can be completed.

-- 1. Add column.
ALTER TABLE symptom_logs
  ADD COLUMN IF NOT EXISTS severities jsonb;

-- 2. Backfill from legacy `severity` only if the old column still
--    exists (i.e. first run of this migration). On re-runs the column
--    is gone and this block becomes a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'symptom_logs' AND column_name = 'severity'
  ) THEN
    EXECUTE $sql$
      UPDATE symptom_logs sl
      SET severities = COALESCE(
        (
          SELECT jsonb_object_agg(t, sl.severity)
          FROM jsonb_array_elements_text(sl.symptom_types) AS t
        ),
        '{}'::jsonb
      )
      WHERE severities IS NULL
    $sql$;
  END IF;
END $$;

-- Defensive: any row still null gets an empty map so the NOT NULL
-- below doesn't fail. App-level validation rejects empty maps on
-- insert/update; this is purely a schema-level safety net.
UPDATE symptom_logs SET severities = '{}'::jsonb WHERE severities IS NULL;

-- 3. Lock the column.
ALTER TABLE symptom_logs ALTER COLUMN severities SET NOT NULL;
ALTER TABLE symptom_logs ALTER COLUMN severities SET DEFAULT '{}'::jsonb;

-- 4. Value range check: every entry must be an INTEGER in [1, 5].
--    Implemented via jsonb_path_exists so the predicate stays
--    subquery-free (CHECK constraints in Postgres can't contain
--    SELECT/EXISTS subqueries). The JSONPath finds any "bad" value —
--    not a number, out of [1, 5], or non-integer — and the constraint
--    succeeds only when no such value exists.
ALTER TABLE symptom_logs
  DROP CONSTRAINT IF EXISTS symptom_logs_severities_range_chk;
ALTER TABLE symptom_logs
  ADD CONSTRAINT symptom_logs_severities_range_chk CHECK (
    jsonb_typeof(severities) = 'object'
    AND NOT jsonb_path_exists(
      severities,
      '$.* ? (@.type() != "number" || @ < 1 || @ > 5 || @ != @.floor())'
    )
  );

-- 5. Drop the legacy column + its check (clean break per spec).
ALTER TABLE symptom_logs DROP CONSTRAINT IF EXISTS symptom_logs_severity_check;
ALTER TABLE symptom_logs DROP COLUMN IF EXISTS severity;

COMMENT ON COLUMN symptom_logs.severities
  IS 'Per-symptom severity map keyed by symptom token (see lib/symptoms.ts SYMPTOM_TYPES). Each value is an integer 1..5. Keys should mirror symptom_types but the constraint is enforced in the app layer, not SQL, so vocabulary changes do not retroactively invalidate rows.';
