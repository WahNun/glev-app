-- Two-value ICR system (Task #277-companion / Lucas-Spec May 14):
-- split the single `user_settings.icr_g_per_unit` into two distinct
-- values so the manual user-set ratio and the engine-computed adaptive
-- ratio never clobber each other.
--
--   * icr_g_per_unit          → user-facing manual value. Now NUMERIC(5,1)
--                                so the Settings UI can accept e.g. 8.5.
--                                Existing INTEGER values are valid NUMERIC
--                                so no data migration is needed.
--                                Source of truth for bolus calc.
--   * icr_g_per_unit_engine   → adaptive engine value. NULL until the
--                                engine has at least 5 finalized meals
--                                (mirrors `computeAdaptiveICR` insufficient-
--                                data threshold). NEVER read by the bolus
--                                calc unless engine_icr_auto_apply=TRUE.
--   * engine_icr_sample_size  → contributing-meal count for the engine
--                                value, so the UI can render
--                                "basiert auf N Mahlzeiten" without
--                                recomputing from raw meals.
--   * engine_icr_updated_at   → freshness for the suggestion line.
--   * engine_icr_auto_apply   → user opt-in. When TRUE the engine also
--                                writes icr_g_per_unit (with audit-trail
--                                entry to adjustment_history) once
--                                sample_size>=10. Default FALSE so
--                                existing users see no behaviour change.
--
-- Idempotent: ALTER TYPE is a no-op when the column is already numeric,
-- ADD COLUMN IF NOT EXISTS guards the new columns.

ALTER TABLE user_settings
  ALTER COLUMN icr_g_per_unit TYPE numeric(5,1)
    USING icr_g_per_unit::numeric(5,1);

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS icr_g_per_unit_engine  numeric(5,1)
    CHECK (icr_g_per_unit_engine BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS engine_icr_sample_size integer
    CHECK (engine_icr_sample_size >= 0),
  ADD COLUMN IF NOT EXISTS engine_icr_updated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS engine_icr_auto_apply  boolean NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN user_settings.icr_g_per_unit
  IS 'User-set manual ICR (g of carb per 1u). Source of truth for bolus calc unless engine_icr_auto_apply=TRUE and the engine has overwritten it. NUMERIC(5,1) — decimals allowed.';
COMMENT ON COLUMN user_settings.icr_g_per_unit_engine
  IS 'Engine-computed adaptive ICR. NULL until enough finalized meals exist. Read-only display unless engine_icr_auto_apply=TRUE.';
COMMENT ON COLUMN user_settings.engine_icr_sample_size
  IS 'Number of finalized meals that fed the most recent engine ICR computation.';
COMMENT ON COLUMN user_settings.engine_icr_updated_at
  IS 'When the engine ICR was last (re)computed and persisted.';
COMMENT ON COLUMN user_settings.engine_icr_auto_apply
  IS 'When TRUE the engine overwrites icr_g_per_unit once sample_size>=10. Default FALSE.';
