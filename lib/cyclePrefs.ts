/**
 * Cycle-logging opt-in preference. DB-backed via
 * `user_settings.cycle_logging_enabled`. When false (default), the
 * "Zyklus loggen" entry is hidden from the header "+" QuickAddMenu.
 * The /engine?tab=cycle route stays reachable so existing entries
 * remain viewable; this flag only gates the new-entry shortcut.
 *
 * Mirrors the read/save shape of `notificationPrefs.ts`: graceful
 * fallback (false) on signed-out / network error, throws on save so
 * the Settings sheet can surface inline errors.
 */

import { supabase } from "./supabase";

/** Window event broadcast after a successful save so already-mounted
 *  consumers (e.g. the QuickAddMenu in the header) can react without
 *  a page reload. */
export const CYCLE_LOGGING_CHANGED_EVENT = "glev:cycle-logging-changed";

export async function fetchCycleLoggingEnabled(): Promise<boolean> {
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await supabase
    .from("user_settings")
    .select("cycle_logging_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return false;
  return data.cycle_logging_enabled === true;
}

export async function saveCycleLoggingEnabled(enabled: boolean): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("user_settings")
    .upsert({
      user_id: user.id,
      cycle_logging_enabled: enabled,
    }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CYCLE_LOGGING_CHANGED_EVENT, { detail: enabled }));
  }
}
