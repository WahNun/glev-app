"use client";

/**
 * lib/criticalAlerts.ts
 *
 * JS interface for the Critical Alerts feature (Phase B + C).
 * Server-side edge functions enforce the flag from Phase A onwards.
 *
 * Dependency chain:
 *   Onboarding / Settings → requestCriticalAlertPermission()
 *     → GlevCriticalAlertsPlugin (Swift, only on iOS native)
 *     → UNUserNotificationCenter.requestAuthorization(options: [.criticalAlert])
 *   DB flag `user_settings.notif_critical_alerts` is always written
 *   regardless of the OS permission outcome — the server uses it to
 *   decide interruption-level (D-026).
 *
 * ⚠️ The Capacitor plugin (GlevCriticalAlertsPlugin.swift) must be added
 *    to the Xcode Compile Sources build phase before the native call works.
 *    On web or Android it fails gracefully (returns { granted: false }).
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { supabase } from "./supabase";

// ── Native plugin bridge (iOS only) ──────────────────────────────────────────

interface GlevCriticalAlertsPlugin {
  requestPermission(): Promise<{ granted: boolean }>;
  checkPermission(): Promise<{ granted: boolean }>;
}

// registerPlugin creates a thin proxy; on non-iOS platforms it returns a
// no-op object so callers don't need runtime platform checks everywhere.
const NativeCriticalAlerts = registerPlugin<GlevCriticalAlertsPlugin>(
  "GlevCriticalAlerts",
  {
    web: {
      requestPermission: async () => ({ granted: false }),
      checkPermission:   async () => ({ granted: false }),
    },
  },
);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Request the iOS CriticalAlert authorization and persist the user's
 * preference to the DB. Returns true if iOS granted the permission.
 *
 * On web / Android: no OS dialog, but DB flag is still written so the
 * server-side edge functions honour the preference.
 */
export async function requestCriticalAlertPermission(): Promise<boolean> {
  let osGranted = false;

  if (Capacitor.getPlatform() === "ios") {
    try {
      const result = await NativeCriticalAlerts.requestPermission();
      osGranted = result.granted;
    } catch (err) {
      // Plugin not yet registered in Xcode (pre-Phase-B build).
      // Log but don't throw — UX proceeds with DB-only flag.
      console.warn("[criticalAlerts] native requestPermission failed:", err);
    }
  }

  // Always write to DB — server enforces via notif_critical_alerts flag.
  await saveCriticalAlertsEnabled(true);
  return osGranted;
}

/**
 * Check current iOS critical-alert authorization without prompting.
 * Returns false on web / Android.
 */
export async function checkCriticalAlertPermission(): Promise<boolean> {
  if (Capacitor.getPlatform() !== "ios") return false;
  try {
    const result = await NativeCriticalAlerts.checkPermission();
    return result.granted;
  } catch {
    return false;
  }
}

/**
 * Write `notif_critical_alerts` to `user_settings` for the current user.
 * Called both on opt-in (true) and opt-out (false).
 */
export async function saveCriticalAlertsEnabled(enabled: boolean): Promise<void> {
  if (!supabase) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("user_settings")
      .update({ notif_critical_alerts: enabled })
      .eq("user_id", user.id);
  } catch (err) {
    console.warn("[criticalAlerts] DB save failed:", err);
  }
}

/**
 * Fetch the current `notif_critical_alerts` flag from `user_settings`.
 * Returns false on error or when not set (conservative default, mirrors D-026).
 */
export async function fetchCriticalAlertsEnabled(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data } = await supabase
      .from("user_settings")
      .select("notif_critical_alerts")
      .maybeSingle();
    return data?.notif_critical_alerts === true;
  } catch {
    return false;
  }
}

/**
 * localStorage key for the "remind me later" snooze (7-day re-prompt gate).
 * Written when user taps "Später" in onboarding to avoid repeated prompts.
 */
export const CRITICAL_ALERTS_SNOOZE_KEY = "glev.criticalAlertsSnooze";
export const CRITICAL_ALERTS_SNOOZE_DAYS = 7;

export function snoozeCriticalAlertsPrompt(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CRITICAL_ALERTS_SNOOZE_KEY, String(Date.now()));
}

export function isCriticalAlertsPromptSnoozed(): boolean {
  if (typeof window === "undefined") return false;
  const raw = localStorage.getItem(CRITICAL_ALERTS_SNOOZE_KEY);
  if (!raw) return false;
  const ts = parseInt(raw, 10);
  if (!Number.isFinite(ts)) return false;
  const daysSince = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return daysSince < CRITICAL_ALERTS_SNOOZE_DAYS;
}
