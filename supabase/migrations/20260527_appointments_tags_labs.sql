-- Extend the appointments table with structured tags (text array) and
-- optional lab values (A1c, eGFR) so doctor visits become a richer
-- clinical timeline instead of a plain date + note log.
--
-- Design choices:
--   • `tags` is a plain text[] column with an application-level
--     vocabulary (Endo, GP, Lab, Ophthalmology, Nephrology, Other).
--     A separate tags table with a junction would be over-engineering
--     for a handful of fixed values; the array is queryable via
--     the `@>` operator if backend filtering is ever needed.
--   • `a1c` and `egfr` are nullable NUMERIC — no default so the column
--     stays NULL when the user doesn't enter a value. Precision:
--     a1c NUMERIC(4,1)  → e.g. 7.2  (range 2.0–20.0 is plenty)
--     egfr NUMERIC(5,1) → e.g. 58.0 (range 0–200+)
--   • Idempotent via IF NOT EXISTS / DO block guards, safe to re-run.
--
-- No data migration needed: existing rows get NULL tags/a1c/egfr,
-- which the UI treats as "no tags / no lab values" — same as before.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS tags   text[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS a1c    numeric(4,1),
  ADD COLUMN IF NOT EXISTS egfr   numeric(5,1);

COMMENT ON COLUMN appointments.tags IS
  'Categorical labels chosen from the app vocabulary (Endo, GP, Lab, Ophthalmology, Nephrology, Other). Stored as a plain text array; validated at the application layer.';

COMMENT ON COLUMN appointments.a1c IS
  'Optional HbA1c value recorded at this visit (%). Nullable — absence means the user did not enter a value.';

COMMENT ON COLUMN appointments.egfr IS
  'Optional estimated glomerular filtration rate recorded at this visit (mL/min/1.73 m²). Nullable.';

-- Notify PostgREST to reload the schema so the new columns are
-- immediately visible without a pod restart (matches the convention
-- used in 20260523_ai_function_calling_schema.sql).
NOTIFY pgrst, 'reload schema';
