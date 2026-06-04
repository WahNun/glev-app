/**
 * Hyper-glucose alarm — fires a local OS notification with
 * `glev_high_alarm.wav` the moment the foreground ticker detects a
 * reading above the user-configured hyper threshold.
 *
 * Mirrors `lib/elevatedAlarm.ts` with a higher default threshold (180).
 */

export const HYPER_ALARM_SOUND = "glev_high_alarm.wav";
export const HYPER_ALARM_COOLDOWN_MS = 15 * 60 * 1000;
export const HYPER_ALARM_NOTIFICATION_ID = 8_000_003;
export const DEFAULT_HYPER_ALARM_THRESHOLD = 180;

const COOLDOWN_KEY = "glev_hyper_alarm_last_fired";
const SETTINGS_KEY = "glev_hyper_alarm";

export interface HyperAlarmSettings {
  enabled: boolean;
  thresholdMgdl: number;
}

export const DEFAULT_HYPER_ALARM_SETTINGS: HyperAlarmSettings = {
  enabled: false,
  thresholdMgdl: DEFAULT_HYPER_ALARM_THRESHOLD,
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

export function getHyperAlarmSettings(): HyperAlarmSettings {
  if (!isBrowser()) return DEFAULT_HYPER_ALARM_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_HYPER_ALARM_SETTINGS;
    const p = JSON.parse(raw) as Record<string, unknown>;
    const enabled = typeof p.enabled === "boolean" ? p.enabled : DEFAULT_HYPER_ALARM_SETTINGS.enabled;
    const thresholdMgdl =
      typeof p.thresholdMgdl === "number" &&
      Number.isFinite(p.thresholdMgdl) &&
      p.thresholdMgdl >= 140 &&
      p.thresholdMgdl <= 250
        ? p.thresholdMgdl
        : DEFAULT_HYPER_ALARM_SETTINGS.thresholdMgdl;
    return { enabled, thresholdMgdl };
  } catch {
    return DEFAULT_HYPER_ALARM_SETTINGS;
  }
}

export function persistHyperAlarmSettingsLocally(settings: HyperAlarmSettings): void {
  if (!isBrowser()) return;
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch { /* localStorage disabled */ }
}

export function isHyperAlarmCooledDown(): boolean {
  if (!isBrowser()) return false;
  try {
    const raw = window.localStorage.getItem(COOLDOWN_KEY);
    if (!raw) return true;
    const lastFired = parseInt(raw, 10);
    if (!Number.isFinite(lastFired)) return true;
    return Date.now() - lastFired >= HYPER_ALARM_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markFired(): void {
  if (!isBrowser()) return;
  try { window.localStorage.setItem(COOLDOWN_KEY, String(Date.now())); }
  catch { /* ignore */ }
}

export interface FireHyperAlarmInput {
  title: string;
  body: string;
}

export async function fireHyperGlucoseAlarm(input: FireHyperAlarmInput): Promise<boolean> {
  if (!isBrowser()) return false;
  if (!isHyperAlarmCooledDown()) return false;

  const mod = await loadModule();
  if (mod) {
    try {
      const { LocalNotifications } = mod;
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") {
        perm = await LocalNotifications.requestPermissions();
      }
      if (perm.display !== "granted") return false;
      try { await LocalNotifications.cancel({ notifications: [{ id: HYPER_ALARM_NOTIFICATION_ID }] }); }
      catch { /* ignore */ }
      await LocalNotifications.schedule({
        notifications: [{
          id: HYPER_ALARM_NOTIFICATION_ID,
          title: input.title,
          body: input.body,
          schedule: { at: new Date(Date.now() + 500) },
          sound: HYPER_ALARM_SOUND,
          extra: { kind: "hyper_glucose_alarm" },
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
    new Notification(input.title, { body: input.body, tag: "glev-hyper-alarm" });
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
export async function checkAndFireIfHyper(
  bg: number,
  threshold: number,
  input: FireHyperAlarmInput,
): Promise<boolean> {
  if (!Number.isFinite(bg) || !Number.isFinite(threshold)) return false;
  if (bg <= threshold) return false;
  return fireHyperGlucoseAlarm(input);
}
