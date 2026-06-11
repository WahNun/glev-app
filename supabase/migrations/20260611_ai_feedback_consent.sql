-- AI Feedback consent scope (DSGVO Art. 6 Abs. 1 lit. a).
-- NULL = not granted, TIMESTAMPTZ = moment of opt-in.
-- Default NULL: users must explicitly opt in; no silent migration.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ai_feedback_consent_at TIMESTAMPTZ DEFAULT NULL;
