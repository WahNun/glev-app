-- Granular Glev AI consent scopes (Task #664).
--
-- Phase 4 (Granular consent): in addition to the master consent flag
-- `profiles.ai_consent_at`, users can now grant or revoke individual
-- data scopes that the chat route filters server-side before building
-- the contextPreamble. Each column is a TIMESTAMPTZ that is NULL when
-- the scope is NOT granted, and holds the moment of opt-in otherwise.
--
-- - ai_consent_glucose_at  → may pass the glucose summary into the
--                            preamble.
-- - ai_consent_iob_at      → may pass the IOB summary into the
--                            preamble.
-- - ai_consent_history_at  → reserved for Phase 5 (7-day history). The
--                            toggle is shipped disabled in the UI; the
--                            column exists already so the chat route
--                            can be written end-to-end now.
--
-- Default NULL (no implicit migration of existing `ai_consent_at`
-- users): we intentionally do not auto-grant the sub-scopes for
-- pre-existing master-consented users — they will see the new
-- toggles in the off position and must opt in explicitly. See
-- DECISIONS.md D-016.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-running the migration
-- against a partially-applied DB is safe.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ai_consent_glucose_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ai_consent_iob_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ai_consent_history_at TIMESTAMPTZ DEFAULT NULL;
