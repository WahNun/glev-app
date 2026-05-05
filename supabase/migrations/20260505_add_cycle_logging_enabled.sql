-- Opt-in toggle for the menstrual-cycle logging shortcut in the
-- header "+" QuickAddMenu. When false (default), "Zyklus loggen"
-- is hidden from the menu. The /engine?tab=cycle route itself
-- stays reachable so existing entries remain viewable; this flag
-- only gates the new-entry shortcut. Lives on `user_settings`
-- alongside the other per-user feature toggles (notif_*).

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS cycle_logging_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_settings.cycle_logging_enabled
  IS 'Opt-in toggle for the menstrual cycle logging shortcut in the header QuickAddMenu.';
