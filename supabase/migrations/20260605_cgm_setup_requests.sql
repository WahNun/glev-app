-- Migration: CGM Setup Lead-Capture
-- Creates the cgm_setup_requests table and adds last_setup_request_at to profiles.

CREATE TABLE IF NOT EXISTS cgm_setup_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sensor_brand       TEXT NOT NULL,
  sensor_model       TEXT,
  device_os          TEXT NOT NULL,
  nightscout_status  TEXT NOT NULL,
  note               TEXT,
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'reached_out', 'resolved', 'closed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for admin list queries
CREATE INDEX IF NOT EXISTS cgm_setup_requests_created_at_idx
  ON cgm_setup_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS cgm_setup_requests_user_id_idx
  ON cgm_setup_requests (user_id);

-- RLS: users can only read their own rows; service-role bypasses RLS entirely.
ALTER TABLE cgm_setup_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own setup requests"
  ON cgm_setup_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own setup requests"
  ON cgm_setup_requests FOR SELECT
  USING (auth.uid() = user_id);

-- Add last_setup_request_at to profiles (nullable, set by server on each submission)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_setup_request_at TIMESTAMPTZ;
