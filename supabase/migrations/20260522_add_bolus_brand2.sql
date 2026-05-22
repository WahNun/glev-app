ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS insulin_brand_bolus_2 TEXT
    CHECK (insulin_brand_bolus_2 IS NULL OR char_length(insulin_brand_bolus_2) <= 40);
