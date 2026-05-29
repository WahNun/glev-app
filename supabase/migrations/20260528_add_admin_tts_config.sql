-- Migration: central Mistral TTS reference-voice config
-- D-030: admin_tts_config stores a single ref_audio (Base64) that the
-- TTS route attaches to every Mistral voxtral request so the voice stays
-- consistent across users and sessions.
--
-- Singleton row: id = 'singleton'. Enforced via CHECK.
-- RLS: enabled, no user-facing policies — service-role only.

CREATE TABLE IF NOT EXISTS admin_tts_config (
  id          TEXT PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  ref_audio   TEXT,            -- Base64-encoded audio (wav/mp3/flac/opus/pcm, max 5 MB)
  voice_id    TEXT,            -- future: persistent Mistral voice_id
  provider    TEXT NOT NULL DEFAULT 'mistral',
  model       TEXT NOT NULL DEFAULT 'voxtral-mini-tts-2603',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_tts_config ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies — only service-role may read/write this table.
