-- Personal info collected during onboarding (and editable in Settings).
--
-- Mandatory in the onboarding flow: sex + birth_year. Height/weight are
-- optional. We store birth_year (not full birthday) so we can compute age
-- without storing PII we don't need.
--
-- `sex` gates the cycle-logging surfaces:
--   - 'female'  → cycle-logging Settings row + QuickAddMenu item visible (opt-in via existing toggle)
--   - 'diverse' → same as 'female' (user can opt in)
--   - 'male'    → both surfaces fully hidden, cycle_logging_enabled is forced false at read-time
--   - NULL      → user predates this migration / skipped onboarding → treated as "not male" (visible)
--
-- All columns are nullable so the migration is safe on existing rows.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sex text
    CHECK (sex IS NULL OR sex IN ('female', 'male', 'diverse')),
  ADD COLUMN IF NOT EXISTS birth_year smallint
    CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
  ADD COLUMN IF NOT EXISTS height_cm smallint
    CHECK (height_cm IS NULL OR height_cm BETWEEN 50 AND 280),
  ADD COLUMN IF NOT EXISTS weight_kg numeric(5,1)
    CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 400);

COMMENT ON COLUMN profiles.sex IS
  'Self-declared biological sex. female|male|diverse. Gates cycle-logging surfaces (male hides them).';
COMMENT ON COLUMN profiles.birth_year IS
  'Year of birth (4 digits). Used to compute age. We deliberately do NOT store full birthday.';
COMMENT ON COLUMN profiles.height_cm IS 'Optional. Height in centimetres.';
COMMENT ON COLUMN profiles.weight_kg IS 'Optional. Weight in kilograms (one decimal).';
