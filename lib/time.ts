/**
 * Timezone-safe timestamp parsers.
 *
 * Two real-world quirks make the naive `new Date(str)` / `Date.parse(str)`
 * dangerous in this app:
 *
 *  1. Postgres `timestamp without time zone` columns serialize back through
 *     PostgREST as ISO strings *without* an offset (e.g. `"2026-04-25T20:00:00"`).
 *     JS interprets those as the runtime's *local* time — so a UTC value gets
 *     silently shifted by the user's TZ offset on display. We expect such
 *     strings to represent UTC (everything we write is UTC instants), so we
 *     append a `Z` before parsing whenever the string has no TZ designator.
 *     Strings produced by `timestamptz` already include `+00:00` (or `Z`) and
 *     are parsed unchanged.
 *
 *  2. LibreLinkUp returns reading timestamps in the legacy
 *     `"M/D/YYYY h:mm:ss AM/PM"` shape, also without a TZ designator. The
 *     LLU server emits these in **UTC**, but `Date.parse` interprets the
 *     format as local time. We parse the components explicitly via
 *     `Date.UTC(...)` so the resulting epoch is correct regardless of the
 *     user's timezone.
 *
 * `toLocaleDateString` / `toLocaleTimeString` on the resulting `Date` then
 * format in the user's device timezone — which is what the UI wants.
 */

/** Parse a DB-origin timestamp string into epoch ms.
 *  Treats TZ-naive ISO strings as UTC. Returns NaN when input is empty/invalid. */
export function parseDbTs(s: string | null | undefined): number {
  if (!s) return NaN;
  const t = s.trim();
  // ISO 8601 without a TZ designator? Assume UTC.
  // Matches "YYYY-MM-DD[T| ]HH:mm" optionally followed by ":ss" or ":ss.fff".
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) {
    return Date.parse(t + "Z");
  }
  return Date.parse(t);
}

/** Same as parseDbTs but returns a Date object (Invalid Date when unparseable). */
export function parseDbDate(s: string | null | undefined): Date {
  return new Date(parseDbTs(s));
}

/** Map a next-intl locale code (e.g. "de", "en") to a BCP-47 tag suitable
 *  for `Intl.DateTimeFormat` / `toLocaleTimeString` / `toLocaleDateString`.
 *
 *  next-intl exposes the active locale as a bare language code ("de", "en")
 *  via `useLocale()`. Passing those to `toLocale*String` works, but the
 *  resulting format is "language-default" — for `en` that's en-US (12h
 *  AM/PM), for `de` that's de-DE (24h). We make the regional choice
 *  explicit here so that:
 *    - DE-Toggle → "de-DE" (24h, dd.mm.yyyy)
 *    - EN-Toggle → "en-US" (12h AM/PM, m/d/yyyy)
 *  stays predictable across the entire app. Already-qualified tags
 *  ("de-CH", "en-GB", …) pass through unchanged. Unknown codes also pass
 *  through, so adding a new locale to next-intl just works.
 */
const BCP47_LOCALE_MAP: Record<string, string> = {
  de: "de-DE",
  en: "en-US",
};

export function localeToBcp47(locale: string | null | undefined): string {
  if (!locale) return "de-DE";
  if (locale.includes("-")) return locale;
  return BCP47_LOCALE_MAP[locale] ?? locale;
}

/** Parse a LibreLinkUp `Timestamp` field (server UTC, "M/D/YYYY h:mm:ss AM/PM")
 *  into epoch ms. Returns null when the string is missing or unrecognised. */
export function parseLluTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (m) {
    let h = parseInt(m[4], 10);
    const ap = (m[7] || "").toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return Date.UTC(
      parseInt(m[3], 10),
      parseInt(m[1], 10) - 1,
      parseInt(m[2], 10),
      h,
      parseInt(m[5], 10),
      parseInt(m[6], 10),
    );
  }
  // Some LLU regions / future SDK versions may emit ISO strings; fall back
  // to the ISO-aware parser instead of raw Date.parse.
  const t = parseDbTs(s);
  return Number.isFinite(t) ? t : null;
}
