-- Decouple CGM glucose source from Apple Health activity sync.
--
-- Previously, workouts/steps backfill was only available when the user
-- chose "apple_health" as their CGM glucose source. This migration adds
-- an independent toggle so any user (including LLU / Nightscout users)
-- can opt into syncing Steps, Active Energy, and Workouts from Apple Health.
--
-- Backfill rule: users who already had cgm_source='apple_health' in
-- profiles implicitly relied on Apple Health for activity data — preserve
-- their behaviour by defaulting the new flag to true for them.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS activity_sync_apple_health boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_settings.activity_sync_apple_health
  IS 'User opted into Apple Health activity sync (Steps, Active Energy, Workouts). Independent of cgm_source.';

-- Backfill: users with Apple Health as CGM source were already syncing
-- activity data, so keep their experience unchanged.
UPDATE user_settings us
SET    activity_sync_apple_health = true
FROM   profiles p
WHERE  p.user_id = us.user_id
  AND  p.cgm_source = 'apple_health'
  AND  us.activity_sync_apple_health = false;
