-- Extend influence_type CHECK constraint to include stress, illness, sleep_deprivation.
-- Previously only: alcohol, cannabis, medication, other.
-- These new types match the InfluenceForm UI options added in Task #1163.
ALTER TABLE influence_logs
  DROP CONSTRAINT IF EXISTS influence_logs_influence_type_check;

ALTER TABLE influence_logs
  ADD CONSTRAINT influence_logs_influence_type_check
  CHECK (influence_type IN (
    'alcohol', 'cannabis', 'medication', 'other',
    'stress', 'illness', 'sleep_deprivation'
  ));
