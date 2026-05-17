// Time-format preference helpers.
//
// Stored per-user in `profiles.time_format` as 'auto' | '24h' | '12h'.
// 'auto' resolves to 24h for DE and 12h (AM/PM) for EN so neither
// audience is forced into the other's convention.
//
// Pure helpers only — the live React state lives in `hooks/useTimeFormat`.

export type TimeFormatPref = "auto" | "24h" | "12h";

export const TIME_FORMAT_PREFS: readonly TimeFormatPref[] = ["auto", "24h", "12h"] as const;

export function isTimeFormatPref(v: unknown): v is TimeFormatPref {
  return v === "auto" || v === "24h" || v === "12h";
}

/**
 * Decide whether to render times in 12h (AM/PM) given the user's
 * stored preference and the active UI locale.
 *
 * Locale list is intentionally small + explicit instead of consulting
 * `Intl.DateTimeFormat(...).resolvedOptions().hour12`, because that
 * value depends on the host runtime's CLDR data and would give
 * inconsistent results between Node SSR and the browser. We support
 * exactly the two locales the app ships today.
 */
export function resolveHour12(pref: TimeFormatPref, locale: string): boolean {
  if (pref === "12h") return true;
  if (pref === "24h") return false;
  // 'auto' — locale-driven.
  const norm = (locale || "").toLowerCase();
  if (norm.startsWith("en")) return true;
  return false;
}

/**
 * Format `date` as a clock string honouring the user's pref + locale.
 * Always two-digit minutes; hour is two-digit so both 12h and 24h
 * outputs are stable-width ("09:05 AM" / "09:05") — important for the
 * Entries grid alignment.
 */
export function formatTime(date: Date, locale: string, pref: TimeFormatPref): string {
  const hour12 = resolveHour12(pref, locale);
  return date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12,
  });
}
