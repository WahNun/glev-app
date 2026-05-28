/**
 * Haptics-enabled preference. DB-backed via
 * `user_settings.haptics_enabled`. Default true — vibrations are on
 * unless the user explicitly disables them in Settings.
 *
 * A localStorage mirror (`glev_haptics_enabled`) is kept in sync so
 * the synchronous gate in `lib/haptics.ts` can read the preference
 * without an async DB call on every tap.
 */

import { supabase } from "./supabase";

export const HAPTICS_LS_KEY = "glev_haptics_enabled";

/** Synchronous read from localStorage — used by the haptics gate. */
export function isHapticsEnabledSync(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(HAPTICS_LS_KEY);
    return v === null || v !== "0";
  } catch {
    return true;
  }
}

function mirrorToLocalStorage(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.removeItem(HAPTICS_LS_KEY);
    } else {
      window.localStorage.setItem(HAPTICS_LS_KEY, "0");
    }
  } catch { /* noop */ }
}

export async function fetchHapticsEnabled(): Promise<boolean> {
  if (!supabase) return true;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return true;

  const { data, error } = await supabase
    .from("user_settings")
    .select("haptics_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return true;
  const enabled = data.haptics_enabled !== false;
  mirrorToLocalStorage(enabled);
  return enabled;
}

export async function saveHapticsEnabled(enabled: boolean): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: user.id, haptics_enabled: enabled }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
  mirrorToLocalStorage(enabled);
}
