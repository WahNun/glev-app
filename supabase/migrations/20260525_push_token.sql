-- Migration: push token storage on profiles
-- Task #693: Server-side Hypo-Push via Supabase Edge Function
--
-- Adds three nullable columns so existing rows are untouched:
--   push_token             — FCM (Android) or APNs (iOS) device registration token
--   push_platform          — "android" or "ios"
--   push_token_updated_at  — when the token was last written
--
-- RLS:
--   UPDATE: any auth'd user may update their own row (existing policy covers this
--           because profiles' RLS policy already allows users to update their own row).
--   SELECT of push_token: only service role — users never need to read back their
--           own token, and exposing tokens to anon/auth clients is unnecessary.
--
-- Idempotent (safe to re-run via pnpm db:migrate).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS push_token            TEXT,
  ADD COLUMN IF NOT EXISTS push_platform         TEXT
    CHECK (push_platform IS NULL OR push_platform IN ('ios', 'android')),
  ADD COLUMN IF NOT EXISTS push_token_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.push_token IS
  'FCM (Android) or APNs (iOS) device registration token. NULL when push is not enabled.';
COMMENT ON COLUMN profiles.push_platform IS
  'Platform of the push token: "ios" or "android". NULL when push_token is NULL.';
COMMENT ON COLUMN profiles.push_token_updated_at IS
  'Timestamp of the last push_token write. Used to detect stale tokens.';
