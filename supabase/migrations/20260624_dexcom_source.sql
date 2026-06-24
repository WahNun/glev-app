-- Dexcom Share Direct — 4th CGM source alongside LLU / Nightscout / Apple Health.
-- Adds Dexcom-specific credential columns to cgm_credentials and makes
-- the existing LLU columns nullable so a Dexcom-only user can have a
-- cgm_credentials row without LLU credentials.
--
-- cgm_source in profiles is TEXT (not an enum type), so no ALTER TYPE needed.
-- The new value 'dexcom' is accepted by the dispatcher once it is written.
--
-- Idempotent (safe to re-run).

-- Make LLU credential columns nullable so Dexcom-only users can have a row
ALTER TABLE cgm_credentials ALTER COLUMN llu_email DROP NOT NULL;
ALTER TABLE cgm_credentials ALTER COLUMN llu_password_encrypted DROP NOT NULL;

-- Dexcom Share credential + session columns
ALTER TABLE cgm_credentials
  ADD COLUMN IF NOT EXISTS dexcom_username           TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dexcom_password_encrypted TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dexcom_region             TEXT
    CHECK (dexcom_region IN ('eu', 'us'))
    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dexcom_session_id         TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dexcom_session_expires    TIMESTAMPTZ DEFAULT NULL;
