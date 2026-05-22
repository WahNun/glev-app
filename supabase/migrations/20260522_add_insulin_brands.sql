ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS insulin_brand_bolus TEXT CHECK (insulin_brand_bolus IS NULL OR char_length(insulin_brand_bolus) <= 40),
  ADD COLUMN IF NOT EXISTS insulin_brand_basal TEXT CHECK (insulin_brand_basal IS NULL OR char_length(insulin_brand_basal) <= 40);
