-- Migration: add style_prefix column to admin_tts_config
-- Stores the TTS speaking-style instructions prepended to every Voxtral request.
-- NULL / empty → TTS route falls back to the hardcoded default.
-- Service-role only (RLS already enabled, no user-facing policies on this table).

ALTER TABLE admin_tts_config
  ADD COLUMN IF NOT EXISTS style_prefix TEXT;
