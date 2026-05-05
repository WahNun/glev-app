-- Refactor menstrual phase tracking + add symptom category for PMS.
--
-- ADDITIVE migration — keeps the legacy `phase_marker` column intact so
-- pre-refactor rows continue to render in the Entries log and Insights
-- card without a destructive backfill. New writes go to `cycle_phase`
-- (4-value standard menstrual cycle enum), and PMS now lives in the
-- existing symptom system as a row-level category instead of a
-- phase_marker. Idempotent (safe to re-run).
--
-- Why additive:
--   * Production beta users may already have phase_marker='pms' /
--     'ovulation' / 'other' rows. Dropping the column or its CHECK
--     would either delete or invalidate those entries.
--   * The new `cycle_phase` column is the canonical write path going
--     forward; reads fall back to `phase_marker` for legacy rows.
--
-- A future cleanup migration can drop `phase_marker` once all rows
-- have a `cycle_phase` value (or the data is acceptable to lose).

-- =================================================================
-- 1. menstrual_logs.cycle_phase — standard 4-phase enum
-- =================================================================
ALTER TABLE menstrual_logs
  ADD COLUMN IF NOT EXISTS cycle_phase text
    CHECK (
      cycle_phase IS NULL
      OR cycle_phase IN ('follicular','ovulation','luteal','menstruation')
    );

COMMENT ON COLUMN menstrual_logs.cycle_phase
  IS 'Standard 4-phase menstrual cycle marker (follicular / ovulation / luteal / menstruation). Replaces phase_marker for new writes; legacy rows keep phase_marker populated for backward-compat reads.';

-- One-shot backfill so existing rows surface meaningfully under the
-- new schema:
--   * phase_marker='pms'       → cycle_phase='luteal'  (PMS sits in luteal)
--   * phase_marker='ovulation' → cycle_phase='ovulation'
--   * phase_marker='other'     → cycle_phase stays NULL (no clean mapping;
--                                user-explicit "Andere" preserved as-is)
UPDATE menstrual_logs
   SET cycle_phase = 'luteal'
 WHERE phase_marker = 'pms' AND cycle_phase IS NULL;

UPDATE menstrual_logs
   SET cycle_phase = 'ovulation'
 WHERE phase_marker = 'ovulation' AND cycle_phase IS NULL;

-- =================================================================
-- 2. Relax the kind constraint so a row carrying only cycle_phase
--    (no flow + no legacy phase_marker) is also valid.
-- =================================================================
ALTER TABLE menstrual_logs DROP CONSTRAINT IF EXISTS menstrual_logs_kind_chk;
ALTER TABLE menstrual_logs ADD CONSTRAINT menstrual_logs_kind_chk CHECK (
  flow_intensity IS NOT NULL
  OR phase_marker IS NOT NULL
  OR cycle_phase  IS NOT NULL
);

-- =================================================================
-- 3. symptom_logs.category — general vs. PMS bucket
-- =================================================================
-- Each row now belongs to one bucket. Existing rows default to
-- 'general'. The PMS category surfaces a curated chip list in the
-- Symptome tab and acts as a luteal-phase signal for insights —
-- without overriding any user-set cycle_phase.
ALTER TABLE symptom_logs
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('general','pms'));

COMMENT ON COLUMN symptom_logs.category
  IS 'Symptom-Kategorie wie vom User beim Loggen gewählt: general (allgemeine Körpersymptome) oder pms (zyklus-bezogene Symptome). PMS-Zeilen werden später für Luteal-Phasen-Insights ausgewertet.';

-- Composite index — read paths typically filter by user + category +
-- recency (e.g. "PMS-Einträge der letzten 30 Tage").
CREATE INDEX IF NOT EXISTS symptom_logs_user_category_idx
  ON symptom_logs (user_id, category, occurred_at DESC);
