/**
 * Notification preferences. DB-backed (`user_settings.notif_*`), so the
 * Settings UI, the future cron sender (Phase 2), and the future push
 * subscriber all read from one source. Mirrors the read/save shape of
 * `userSettings.ts` (graceful fallback on signed-out / network error,
 * throws on save so the UI can surface inline errors).
 */

import { supabase } from "./supabase";

export interface NotificationPrefs {
  /** Send hypo/hyper push alerts when CGM is in critical range. */
  criticalAlerts: boolean;
  /** Send habit-based meal-time reminders learned from meal_logs.
   *  Phase 1: stored but not yet delivered (Phase 2 wires the sender). */
  smartReminders: boolean;
  /** Local "HH:mm" string. Non-critical notifications are suppressed
   *  between quietStart and quietEnd. Wraps over midnight when start > end. */
  quietStart: string;
  /** Local "HH:mm" string. */
  quietEnd: string;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  criticalAlerts: true,
  smartReminders: false,
  quietStart: "22:00",
  quietEnd: "07:00",
};

/** Postgres `time` returns "HH:MM:SS" — keep only HH:MM for the <input type="time">. */
function trimSeconds(t: string | null | undefined, fallback: string): string {
  if (!t) return fallback;
  const m = /^(\d{2}:\d{2})/.exec(t);
  return m ? m[1] : fallback;
}

/**
 * Returns the current user's notification preferences, or DEFAULTS when
 * no row exists / user not signed in / DB error. Never throws.
 */
export async function fetchNotificationPrefs(): Promise<NotificationPrefs> {
  if (!supabase) return DEFAULT_NOTIFICATION_PREFS;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULT_NOTIFICATION_PREFS;

  const { data, error } = await supabase
    .from("user_settings")
    .select("notif_critical_alerts, notif_smart_reminders, notif_quiet_start, notif_quiet_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return DEFAULT_NOTIFICATION_PREFS;
  return {
    criticalAlerts: data.notif_critical_alerts ?? DEFAULT_NOTIFICATION_PREFS.criticalAlerts,
    smartReminders: data.notif_smart_reminders ?? DEFAULT_NOTIFICATION_PREFS.smartReminders,
    quietStart:     trimSeconds(data.notif_quiet_start as string | null, DEFAULT_NOTIFICATION_PREFS.quietStart),
    quietEnd:       trimSeconds(data.notif_quiet_end   as string | null, DEFAULT_NOTIFICATION_PREFS.quietEnd),
  };
}

/**
 * Upserts the notification preferences for the signed-in user. Throws on
 * auth / DB error so the Settings sheet can keep itself open with an
 * inline error and the user's in-progress edits.
 */
export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("user_settings")
    .upsert({
      user_id:               user.id,
      notif_critical_alerts: prefs.criticalAlerts,
      notif_smart_reminders: prefs.smartReminders,
      notif_quiet_start:     prefs.quietStart,
      notif_quiet_end:       prefs.quietEnd,
    }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
}
