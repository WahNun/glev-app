ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS insulin_type TEXT DEFAULT 'rapid'
    CHECK (insulin_type IN ('rapid', 'regular', 'unknown')),
  ADD COLUMN IF NOT EXISTS dia_hours FLOAT DEFAULT 3.0;
