-- meal_glucose_curve — volle CGM-Kurve pro Mahlzeit für echte Analytics.
--
-- Warum: meal_timeline_checks/post_1h speichert nur den ersten CGM-Wert im
-- ±15-min-Fenster (first-write-wins). Das ist kein echter Spitzenwert.
-- Diese Tabelle speichert JEDEN CGM-Wert im 0–180-min-Fenster nach einer
-- Mahlzeit → Peak, Time-to-Peak, AUC, Time-in-Range post-meal sind damit
-- vollständig berechenbar.
--
-- Schreibpfad: cron/cgm-poll (alle 2 min) via insertMealGlucoseCurve().
-- Leicht anders als meal-hypo-check (der liest hier nicht, sondern aus cgm_samples).
--
-- Idempotent (IF NOT EXISTS + UNIQUE-Index).
-- BEREITS AUF PRODUCTION APPLIED via Supabase MCP am 2026-06-27.

CREATE TABLE IF NOT EXISTS meal_glucose_curve (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  meal_id      UUID        NOT NULL REFERENCES meals(id)        ON DELETE CASCADE,
  measured_at  TIMESTAMPTZ NOT NULL,
  t_offset_min INTEGER     NOT NULL,   -- Minuten nach meal_time (0–180)
  value_mgdl   NUMERIC     NOT NULL,
  source       TEXT,                   -- 'llu' | 'nightscout' | 'dexcom' | 'apple_health'
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (meal_id, measured_at)
);

CREATE INDEX IF NOT EXISTS idx_mgc_meal ON meal_glucose_curve(meal_id, measured_at);
CREATE INDEX IF NOT EXISTS idx_mgc_user ON meal_glucose_curve(user_id, measured_at);

ALTER TABLE meal_glucose_curve ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own meal_glucose_curve"
  ON meal_glucose_curve FOR SELECT
  USING (auth.uid() = user_id);
