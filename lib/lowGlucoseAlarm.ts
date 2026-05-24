/**
 * Low-glucose alarm — fires a local OS notification with a dedicated
 * alarm sound (`glev_low_alarm.wav`) the moment CGM polling detects a
 * reading below the user-configured threshold.
 *
 * Design decisions (v1):
 *  - Cooldown: one alarm per 15 minutes (COOLDOWN_MS). Prevents spam
 *    during a sustained hypo without silencing a genuinely new event
 *    once the window expires.
 *  - No server-side push in v1 — the local notification fires while
 *    the app is backgrounded on native (Capacitor). Server-push is a
 *    separate follow-up task.
 *  - Sound: `glev_low_alarm.wav` — distinct filename from meal-check
 *    sounds (`glev_pre_check.wav` / `glev_post_check.wav`) so users
 *    immediately distinguish urgency by ear alone.
 *
 * Pattern mirrors `lib/mealCheckReminders.ts`.
 */

export const LOW_ALARM_SOUND = "glev_low_alarm.wav";
export const LOW_ALARM_COOLDOWN_MS = 15 * 60 * 1000;
export const LOW_ALARM_NOTIFICATION_ID = 8_000_001;
export const DEFAULT_LOW_ALARM_THRESHOLD = 70;

const ALARM_COOLDOWN_KEY  = "glev_low_alarm_last_fired";
const ALARM_SETTINGS_KEY  = "glev_low_alarm";

type LocalNotificationsModule = typeof import("@capacitor/local-notifications");
let modCache: LocalNotificationsModule | null | undefined;
let isNativeCache: boolean | undefined;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function isNativePlatform(): boolean {
  if (isNativeCache !== undefined) return isNativeCache;
  if (!isBrowser()) { isNativeCache = false; return false; }
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  isNativeCache = !!w.Capacitor?.isNativePlatform?.();
  return isNativeCache;
}

async function loadModule(): Promise<LocalNotificationsModule | null> {
  if (modCache !== undefined) return modCache;
  if (!isNativePlatform()) { modCache = null; return null; }
  try { modCache = await import("@capacitor/local-notifications"); }
  catch { modCache = null; }
  return modCache;
}

export interface LowAlarmSettings {
  enabled: boolean;
  thresholdMgdl: number;
}

export const DEFAULT_LOW_ALARM_SETTINGS: LowAlarmSettings = {
  enabled: true,
  thresholdMgdl: DEFAULT_LOW_ALARM_THRESHOLD,
};

export function getLowAlarmSettings(): LowAlarmSettings {
  if (!isBrowser()) return DEFAULT_LOW_ALARM_SETTINGS;
  try {
    const raw = window.localStorage.getItem(ALARM_SETTINGS_KEY);
    if (!raw) return DEFAULT_LOW_ALARM_SETTINGS;
    const p = JSON.parse(raw) as Record<string, unknown>;
    const enabled = typeof p.enabled === "boolean" ? p.enabled : DEFAULT_LOW_ALARM_SETTINGS.enabled;
    const thresholdMgdl =
      typeof p.thresholdMgdl === "number" &&
      Number.isFinite(p.thresholdMgdl) &&
      p.thresholdMgdl >= 40 &&
      p.thresholdMgdl <= 90
        ? p.thresholdMgdl
        : DEFAULT_LOW_ALARM_SETTINGS.thresholdMgdl;
    return { enabled, thresholdMgdl };
  } catch {
    return DEFAULT_LOW_ALARM_SETTINGS;
  }
}

export function persistLowAlarmSettingsLocally(settings: LowAlarmSettings): void {
  if (!isBrowser()) return;
  try { window.localStorage.setItem(ALARM_SETTINGS_KEY, JSON.stringify(settings)); }
  catch { /* localStorage disabled */ }
}

export function isAlarmCooledDown(): boolean {
  if (!isBrowser()) return false;
  try {
    const raw = window.localStorage.getItem(ALARM_COOLDOWN_KEY);
    if (!raw) return true;
    const lastFired = parseInt(raw, 10);
    if (!Number.isFinite(lastFired)) return true;
    return Date.now() - lastFired >= LOW_ALARM_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markAlarmFired(): void {
  if (!isBrowser()) return;
  try { window.localStorage.setItem(ALARM_COOLDOWN_KEY, String(Date.now())); }
  catch { /* ignore */ }
}

/**
 * Snooze the alarm for `minutes` minutes by backdating the last-fired
 * timestamp so the cooldown window only expires after the snooze.
 */
export function snoozeLowAlarm(minutes: number): void {
  if (!isBrowser()) return;
  const backdated = Date.now() - LOW_ALARM_COOLDOWN_MS + minutes * 60 * 1000;
  try { window.localStorage.setItem(ALARM_COOLDOWN_KEY, String(backdated)); }
  catch { /* ignore */ }
}

export interface FireLowAlarmInput {
  title: string;
  body: string;
}

/**
 * Fires the low-glucose alarm immediately. Respects the 15-minute
 * cooldown — returns `false` without doing anything if the last alarm
 * fired within the window.
 *
 * On native Capacitor: uses `@capacitor/local-notifications` with the
 * `glev_low_alarm.wav` sound. A fixed notification ID ensures a rapid
 * re-trigger replaces rather than stacks the pending alert.
 * On web (tab open): fires a plain `Notification` API call.
 * On SSR / no window: no-op.
 *
 * Returns `true` if an alarm was actually armed.
 */
export async function fireLowGlucoseAlarm(input: FireLowAlarmInput): Promise<boolean> {
  if (!isBrowser()) return false;
  if (!isAlarmCooledDown()) return false;

  const mod = await loadModule();
  if (mod) {
    try {
      const { LocalNotifications } = mod;
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") {
        perm = await LocalNotifications.requestPermissions();
      }
      if (perm.display !== "granted") return false;
      try { await LocalNotifications.cancel({ notifications: [{ id: LOW_ALARM_NOTIFICATION_ID }] }); }
      catch { /* ignore */ }
      await LocalNotifications.schedule({
        notifications: [{
          id: LOW_ALARM_NOTIFICATION_ID,
          title: input.title,
          body: input.body,
          schedule: { at: new Date(Date.now() + 500) },
          sound: LOW_ALARM_SOUND,
          extra: { kind: "low_glucose_alarm" },
        }],
      });
      markAlarmFired();
      return true;
    } catch {
      return false;
    }
  }

  if (!isBrowser() || typeof Notification === "undefined") return false;
  try {
    if (Notification.permission === "default") {
      const granted = await Notification.requestPermission();
      if (granted !== "granted") return false;
    }
    if (Notification.permission !== "granted") return false;
    new Notification(input.title, { body: input.body, tag: "glev-low-alarm" });
    markAlarmFired();
    return true;
  } catch {
    return false;
  }
}

/**
 * Convenience wrapper: checks `bg` against `threshold` and fires the
 * alarm if the value is below threshold and the cooldown has passed.
 * Returns `true` if the alarm was actually fired.
 */
export async function checkAndFireIfLow(
  bg: number,
  threshold: number,
  input: FireLowAlarmInput,
): Promise<boolean> {
  if (!Number.isFinite(bg) || !Number.isFinite(threshold)) return false;
  if (bg >= threshold) return false;
  return fireLowGlucoseAlarm(input);
}
