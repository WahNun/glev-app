-- Adds the onboarding-completion marker to `profiles`.
--
-- Per product decision (1b in the gate-design discussion): NO BACKFILL.
-- All existing users will see the onboarding flow on their next sign-in,
-- which gives a single, consistent baseline for everyone (incl. Lucas).
-- Users who don't want to re-do it can hit Skip — that also writes a
-- timestamp, so the gate fires exactly once per user.
--
-- Reset path: Settings → "Onboarding wiederholen" calls
-- `POST /api/onboarding { action: "reset" }` which sets the column back
-- to NULL, so users can replay the flow on demand.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- Partial index — we only ever query for "is it null?" inside the
-- protected-layout gate, so the partial index keeps writes cheap and
-- the lookup O(1) for users who still need to onboard.
CREATE INDEX IF NOT EXISTS profiles_onboarding_pending_idx
  ON profiles (id)
  WHERE onboarding_completed_at IS NULL;
