/**
 * Elevated-glucose alarm — fires a local OS notification with
 * `glev_elevated.wav` the moment the foreground ticker detects a
 * reading above the user-configured elevated threshold.
 *
 * Mirrors `lib/lowGlucoseAlarm.ts` exactly, but fires in the HIGH
 * direction (value > threshold).
 *
 * Cooldown: 15 minutes, stored in localStorage so it survives page
 * reloads but resets on the next app launch on a new device session.
 */

export const ELEVATED_ALARM_SOUND = "glev_elevated.wav";
export const ELEVATED_ALARM_COOLDOWN_MS = 15 * 60 * 1000;
export const ELEVATED_ALARM_NOTIFICATION_ID = 8_000_002;
export const DEFAULT_ELEVATED_ALARM_THRESHOLD = 140;

const COOLDOWN_KEY  = "glev_elevated_alarm_last_fired";
const SETTINGS_KEY  = "glev_elevated_alarm";

export interface ElevatedAlarmSettings {
  enabled: boolean;
  thresholdMgdl: number;
}

export const DEFAULT_ELEVATED_ALARM_SETTINGS: ElevatedAlarmSettings = {
  enabled: false,
  thresholdMgdl: DEFAULT_ELEVATED_ALARM_THRESHOLD,
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function isNativePlatform(): boolean {
  if (!isBrowser()) return false;
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!w.Capacitor?.isNativePlatform?.();
}

type LocalNotificationsModule = typeof import("@capacitor/local-notifications");
let modCache: LocalNotificationsModule | null | undefined;

async function loadModule(): Promise<LocalNotificationsModule | null> {
  if (modCache !== undefined) return modCache;
  if (!isNativePlatform()) { modCache = null; return null; }
  try { modCache = await import("@capacitor/local-notifications"); }
  catch { modCache = null; }
  return modCache;
}

export function getElevatedAlarmSettings(): ElevatedAlarmSettings {
  if (!isBrowser()) return DEFAULT_ELEVATED_ALARM_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_ELEVATED_ALARM_SETTINGS;
    const p = JSON.parse(raw) as Record<string, unknown>;
    const enabled = typeof p.enabled === "boolean" ? p.enabled : DEFAULT_ELEVATED_ALARM_SETTINGS.enabled;
    const thresholdMgdl =
      typeof p.thresholdMgdl === "number" &&
      Number.isFinite(p.thresholdMgdl) &&
      p.thresholdMgdl >= 100 &&
      p.thresholdMgdl <= 180
        ? p.thresholdMgdl
        : DEFAULT_ELEVATED_ALARM_SETTINGS.thresholdMgdl;
    return { enabled, thresholdMgdl };
  } catch {
    return DEFAULT_ELEVATED_ALARM_SETTINGS;
  }
}

export function persistElevatedAlarmSettingsLocally(settings: ElevatedAlarmSettings): void {
  if (!isBrowser()) return;
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch { /* localStorage disabled */ }
}

export function isElevatedAlarmCooledDown(): boolean {
  if (!isBrowser()) return false;
  try {
    const raw = window.localStorage.getItem(COOLDOWN_KEY);
    if (!raw) return true;
    const lastFired = parseInt(raw, 10);
    if (!Number.isFinite(lastFired)) return true;
    return Date.now() - lastFired >= ELEVATED_ALARM_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markFired(): void {
  if (!isBrowser()) return;
  try { window.localStorage.setItem(COOLDOWN_KEY, String(Date.now())); }
  catch { /* ignore */ }
}

export interface FireElevatedAlarmInput {
  title: string;
  body: string;
}

export async function fireElevatedGlucoseAlarm(input: FireElevatedAlarmInput): Promise<boolean> {
  if (!isBrowser()) return false;
  if (!isElevatedAlarmCooledDown()) return false;

  const mod = await loadModule();
  if (mod) {
    try {
      const { LocalNotifications } = mod;
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") {
        perm = await LocalNotifications.requestPermissions();
      }
      if (perm.display !== "granted") return false;
      try { await LocalNotifications.cancel({ notifications: [{ id: ELEVATED_ALARM_NOTIFICATION_ID }] }); }
      catch { /* ignore */ }
      await LocalNotifications.schedule({
        notifications: [{
          id: ELEVATED_ALARM_NOTIFICATION_ID,
          title: input.title,
          body: input.body,
          schedule: { at: new Date(Date.now() + 500) },
          sound: ELEVATED_ALARM_SOUND,
          extra: { kind: "elevated_glucose_alarm" },
        }],
      });
      markFired();
      return true;
    } catch {
      return false;
    }
  }

  if (typeof Notification === "undefined") return false;
  try {
    if (Notification.permission === "default") {
      const granted = await Notification.requestPermission();
      if (granted !== "granted") return false;
    }
    if (Notification.permission !== "granted") return false;
    new Notification(input.title, { body: input.body, tag: "glev-elevated-alarm" });
    markFired();
    return true;
  } catch {
    return false;
  }
}

/**
 * Fires when `bg > threshold` and the cooldown has passed.
 * Returns `true` if the alarm was actually fired.
 */
export async function checkAndFireIfElevated(
  bg: number,
  threshold: number,
  input: FireElevatedAlarmInput,
): Promise<boolean> {
  if (!Number.isFinite(bg) || !Number.isFinite(threshold)) return false;
  if (bg <= threshold) return false;
  return fireElevatedGlucoseAlarm(input);
}
