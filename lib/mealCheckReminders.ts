/**
 * Schedules a local OS-level reminder for a confirmed post-bolus
 * timeline check. Used by the Meal-Node-Cluster (Task #673) so the
 * planned `meal_timeline_checks.planned_at` actually nudges the user
 * at the right moment — with a different sound than the existing
 * push-notification flow so a "BZ jetzt prüfen" alert is audibly
 * distinguishable from generic Glev pushes.
 *
 * Native shells (Capacitor iOS/Android) use `@capacitor/local-notifications`
 * because we need the alert to fire even when the app is backgrounded
 * and even without a server round-trip — server-side push reminders
 * would require an Edge-Function cron and per-user FCM/APNs tokens,
 * which is a separate Phase-3 task. Web browsers fall back to the
 * standard `Notification` API + `setTimeout` (best-effort: tab must
 * stay open). SSR / Node calls no-op.
 *
 * Sound:
 *   • Pre-bolus check  → `glev_pre_check.wav`  (intended placeholder
 *     filename; Android/iOS shells must ship the asset for it to play.
 *     Missing file degrades to the platform default.)
 *   • Post-bolus check → `glev_post_check.wav` (different from
 *     low-glucose alarms, follow-up task).
 */

import type { MealCheckType } from "@/lib/mealTimelineChecks";

type LocalNotificationsModule = typeof import("@capacitor/local-notifications");

let modCache: LocalNotificationsModule | null | undefined;
let isNativeCache: boolean | undefined;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function isNativePlatform(): boolean {
  if (isNativeCache !== undefined) return isNativeCache;
  if (!isBrowser()) {
    isNativeCache = false;
    return false;
  }
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  isNativeCache = !!w.Capacitor?.isNativePlatform?.();
  return isNativeCache;
}

async function loadModule(): Promise<LocalNotificationsModule | null> {
  if (modCache !== undefined) return modCache;
  if (!isNativePlatform()) {
    modCache = null;
    return null;
  }
  try {
    modCache = await import("@capacitor/local-notifications");
  } catch {
    modCache = null;
  }
  return modCache;
}

export function soundForCheckType(checkType: MealCheckType | string): string {
  if (checkType === "pre") return "glev_pre_check.wav";
  return "glev_post_check.wav";
}

/**
 * Deterministic 32-bit numeric id derived from `mealId|checkType` so a
 * repeated schedule for the same (meal, check_type) replaces the prior
 * pending notification instead of stacking up duplicates after the
 * user drags the same arm twice.
 */
export function reminderIdFor(mealId: string, checkType: string): number {
  const s = `${mealId}|${checkType}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Capacitor requires positive int32. Mask the sign bit.
  return h & 0x7fffffff;
}

export interface ScheduleReminderInput {
  mealId: string;
  checkType: MealCheckType | string;
  plannedAt: string; // ISO
  title: string;
  body: string;
}

/**
 * Schedule (or replace) a single local reminder. Silently no-ops on:
 *   • SSR / Node (no window)
 *   • Capacitor unavailable + Notification API unavailable
 *   • `plannedAt` already in the past
 *
 * Returns `true` if a reminder was actually armed, `false` otherwise.
 * Failures are swallowed — a missed reminder must never break the
 * underlying confirm-write of `meal_timeline_checks`.
 */
export async function scheduleCheckReminder(input: ScheduleReminderInput): Promise<boolean> {
  const fireAt = new Date(input.plannedAt).getTime();
  if (!Number.isFinite(fireAt) || fireAt <= Date.now()) return false;
  const id = reminderIdFor(input.mealId, input.checkType);
  const sound = soundForCheckType(input.checkType);

  // Native path — survives backgrounding, plays custom sound.
  const mod = await loadModule();
  if (mod) {
    try {
      const { LocalNotifications } = mod;
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") {
        perm = await LocalNotifications.requestPermissions();
      }
      if (perm.display !== "granted") return false;
      // `cancel` first so a re-drag of the same arm doesn't queue two
      // alerts. `schedule` itself overwrites by id on most platforms,
      // but explicit cancel is the documented safe path.
      try { await LocalNotifications.cancel({ notifications: [{ id }] }); } catch { /* ignore */ }
      await LocalNotifications.schedule({
        notifications: [{
          id,
          title: input.title,
          body: input.body,
          schedule: { at: new Date(fireAt) },
          sound,
          extra: { kind: "meal_timeline_check", mealId: input.mealId, checkType: input.checkType },
        }],
      });
      return true;
    } catch {
      return false;
    }
  }

  // Web fallback — best-effort. Requires the tab to stay open until
  // fireAt. Useful for PWA / desktop dev sessions; native shells take
  // the path above.
  if (!isBrowser() || typeof Notification === "undefined") return false;
  try {
    if (Notification.permission === "default") {
      const granted = await Notification.requestPermission();
      if (granted !== "granted") return false;
    }
    if (Notification.permission !== "granted") return false;
    const delay = fireAt - Date.now();
    if (delay > 0x7fffffff) return false; // setTimeout max
    window.setTimeout(() => {
      try {
        const n = new Notification(input.title, {
          body: input.body,
          tag: `glev-check-${id}`,
        });
        // Dispatch the BZ-capture event when the user clicks the web
        // notification so MealCheckReminderProvider can show the input
        // sheet. On many browsers onclick fires even when the tab is
        // in the background; the event itself is harmless if the tab
        // is not visible (the sheet will open when the user returns).
        n.onclick = () => {
          dispatchCheckReminderEvent(input.mealId, input.checkType, input.body);
          n.close();
        };
      } catch { /* ignore */ }
    }, delay);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dispatch the `glev:meal-check-reminder` CustomEvent that
 * MealCheckReminderProvider listens for to show the BZ input sheet.
 *
 * Exported so the native-notification tap path in
 * MealCheckReminderProvider can call it directly (the actual
 * LocalNotifications listener lives there because it needs to be
 * mounted as a React component to manage modal state).
 */
export function dispatchCheckReminderEvent(
  mealId: string,
  checkType: string,
  label?: string,
): void {
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent("glev:meal-check-reminder", {
      detail: { mealId, checkType, label },
    }),
  );
}

/**
 * Attaches a one-time `localNotificationActionPerformed` listener for
 * Capacitor LocalNotifications. When the user taps a scheduled
 * meal-timeline-check notification, this dispatches the
 * `glev:meal-check-reminder` CustomEvent so MealCheckReminderProvider
 * can open the BZ input sheet.
 *
 * Call this once from MealCheckReminderProvider on mount. Returns a
 * cleanup function that removes the listener. No-ops on web / SSR.
 *
 * We attach the listener here rather than inside scheduleCheckReminder
 * because the listener needs to persist across the full app lifetime,
 * not just while a reminder is being scheduled.
 */
export async function initCheckReminderListener(): Promise<() => void> {
  const mod = await loadModule();
  if (!mod) return () => {};
  try {
    const { LocalNotifications } = mod;
    const handle = await LocalNotifications.addListener(
      "localNotificationActionPerformed",
      (action) => {
        const extra = action.notification?.extra as
          | { kind?: string; mealId?: string; checkType?: string }
          | undefined;
        if (extra?.kind !== "meal_timeline_check") return;
        const { mealId, checkType } = extra;
        if (!mealId || !checkType) return;
        dispatchCheckReminderEvent(mealId, checkType, action.notification?.body);
      },
    );
    return () => {
      try { handle.remove(); } catch { /* ignore */ }
    };
  } catch {
    return () => {};
  }
}
