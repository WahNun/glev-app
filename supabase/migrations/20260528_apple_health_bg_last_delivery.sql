-- Track the last time the iOS background observer (AppDelegate HealthKitGlucoseBackgroundSync)
-- successfully delivered samples to /api/cgm/apple-health/sync.
-- NULL = background delivery has never been recorded (new install, or feature just shipped).
-- Updated server-side whenever a POST arrives with source='background' and inserts > 0.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS apple_health_bg_last_delivery timestamptz;
