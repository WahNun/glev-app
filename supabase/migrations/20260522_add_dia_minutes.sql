ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS dia_minutes INTEGER
    CHECK (dia_minutes IS NULL OR (dia_minutes >= 60 AND dia_minutes <= 360));
