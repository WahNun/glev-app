-- Freier Gift-Label auf profiles — zeigt im Admin an, ob und warum
-- ein User kostenlosen Zugang hat (z.B. "Lifetime Access", "1 Jahr kostenlos").
-- Rein informativ: hat keinen Einfluss auf computeEffectivePlan.
-- Das eigentliche Plan-Grant geschieht weiterhin via manual_plan_override.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS gift_label text;

COMMENT ON COLUMN profiles.gift_label IS
  'Admin-vergebenes Label für geschenkten Zugang (z.B. "Lifetime Access", "1 Jahr kostenlos"). Nur informativ — computeEffectivePlan wertet manual_plan_override aus.';
