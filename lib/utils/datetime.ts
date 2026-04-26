/**
 * Single source of truth for date/time boundaries and display.
 *
 * All boundary calculations (today, last N days, N days ago) anchor on the
 * USER's local timezone — the calendar day they see on their device — not
 * UTC and not the server's timezone. DB timestamps are stored as UTC instants
 * (see lib/time.ts) and converted via `parseDbTs` before any comparison or
 * display, so TZ-naive Postgres `timestamp without time zone` values are
 * handled correctly.
 *
 * IMPORTANT — never use `new Date().setHours(0,0,0,0)`. That mutates the
 * Date in the *runtime* timezone, which silently differs from the user's
 * timezone in SSR contexts (server is UTC, user might be Europe/Berlin) and
 * also produces wrong boundaries on DST-transition days. The functions
 * below resolve "midnight in `userTimezone`" via `Intl.DateTimeFormat`,
 * which is correct in every runtime.
 */

import { parseDbTs } from "@/lib/time";

/** User's local timezone (browser-resolved at module load). */
export const userTimezone: string =
  Intl.DateTimeFormat().resolvedOptions().timeZone;

// ─── Internal Intl helpers ──────────────────────────────────────────────────
// These compute "what wall-clock does `tz` show for this UTC instant" and
// reverse the calculation to find the UTC instant of "midnight in tz on date X".

const _wallClockFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: userTimezone,
  hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

interface WallClock { y: number; mo: number; d: number; h: number; mi: number; s: number; }

function wallClockIn(date: Date): WallClock {
  const p = _wallClockFmt.formatToParts(date);
  const v = (t: string) => Number(p.find(x => x.type === t)!.value);
  let h = v("hour");
  if (h === 24) h = 0; // some locales emit "24" for midnight
  return { y: v("year"), mo: v("month"), d: v("day"), h, mi: v("minute"), s: v("second") };
}

/** UTC-instant for "y-mo-d 00:00:00 in `userTimezone`". */
function utcMidnightFor(y: number, mo: number, d: number): number {
  // First guess: treat the wall-clock as if it were UTC.
  const naive = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  // Find the offset of `userTimezone` at that instant by re-formatting it.
  const wc = wallClockIn(new Date(naive));
  const tzAsUtc = Date.UTC(wc.y, wc.mo - 1, wc.d, wc.h, wc.mi, wc.s);
  const offsetMs = tzAsUtc - naive;
  return naive - offsetMs;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Midnight (00:00:00.000) of the given date in the user's local timezone. */
export function startOfDay(date: Date): Date {
  const wc = wallClockIn(date);
  return new Date(utcMidnightFor(wc.y, wc.mo, wc.d));
}

/** Midnight of today (00:00:00.000) in the user's local timezone. */
export function startOfToday(): Date {
  return startOfDay(new Date());
}

/**
 * Midnight `n` calendar days before today in the user's local timezone.
 * `startOfDaysAgo(0)` === `startOfToday()`. `startOfDaysAgo(7)` is the
 * lower-bound for a "last 7 days" calendar window (today + previous 6 days
 * → pass 7 here, the window starts at midnight 6 days ago — see
 * `isWithinDays` for the matching predicate).
 */
export function startOfDaysAgo(n: number): Date {
  const today = wallClockIn(new Date());
  // Use UTC arithmetic on the wall-clock date (safe: no DST hour drift since
  // we're operating purely on calendar Y/M/D), then re-anchor to TZ midnight.
  const shifted = new Date(Date.UTC(today.y, today.mo - 1, today.d - n));
  return new Date(utcMidnightFor(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  ));
}

/**
 * True if the UTC DB timestamp falls on today's calendar day in the user's
 * local timezone. Returns false for missing or unparseable input.
 */
export function isToday(utcTimestamp: string): boolean {
  const t = parseDbTs(utcTimestamp);
  if (!Number.isFinite(t)) return false;
  const start = startOfToday().getTime();
  const end = startOfDaysAgo(-1).getTime(); // = startOfTomorrow
  return t >= start && t < end;
}

/**
 * True if the UTC DB timestamp falls within the last `n` calendar days in
 * the user's local timezone — i.e. between midnight of `n - 1` days ago
 * and the current moment. `isWithinDays(ts, 1)` is equivalent to
 * `isToday(ts)`. Returns false for missing or unparseable input.
 */
export function isWithinDays(utcTimestamp: string, n: number): boolean {
  const t = parseDbTs(utcTimestamp);
  if (!Number.isFinite(t)) return false;
  const days = Math.max(0, Math.floor(n) - 1);
  const start = startOfDaysAgo(days).getTime();
  return t >= start && t <= Date.now();
}

/**
 * Format a UTC DB timestamp for display in the user's local timezone.
 *   - "time"     → "14:32"
 *   - "date"     → e.g. "26.04.2026" (locale-dependent)
 *   - "datetime" → e.g. "26.04.2026, 14:32"
 * Returns "—" for missing or unparseable input so callers never crash.
 */
export function formatLocalTime(
  utcTimestamp: string,
  format: "time" | "date" | "datetime",
): string {
  const t = parseDbTs(utcTimestamp);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  switch (format) {
    case "time":
      return d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: userTimezone,
      });
    case "date":
      return d.toLocaleDateString(undefined, { timeZone: userTimezone });
    case "datetime":
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: userTimezone,
      });
  }
}
