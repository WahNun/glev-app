-- Adds a per-user UI language preference to the profiles table.
-- Used by next-intl to load the correct messages bundle on every
-- request. Default 'de' matches the app's primary audience (German
-- T1D users) and ensures existing rows immediately have a valid value.
-- The column is plain text (not enum) so we can add languages later
-- without an ALTER TYPE migration.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS language text DEFAULT 'de';
