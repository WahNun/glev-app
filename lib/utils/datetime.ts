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
 * Note on SSR: `userTimezone` resolves at module load. On the client this is
 * the browser's timezone (the desired behavior). During Server Components /
 * SSR rendering it resolves to the server's TZ. Components that bucket data
 * by date should hydrate on the client; the boundary functions below all use
 * the local Date methods, which honor the runtime timezone consistently.
 */

import { parseDbTs } from "@/lib/time";

/** User's local timezone (browser-resolved at module load). */
export const userTimezone: string =
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Midnight (00:00:00.000) of the given date in the user's local timezone. */
export function startOfDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Midnight of today (00:00:00.000) in the user's local timezone. */
export function startOfToday(): Date {
  return startOfDay(new Date());
}

/**
 * Midnight `n` calendar days before today, in the user's local timezone.
 * `startOfDaysAgo(0)` === `startOfToday()`. `startOfDaysAgo(7)` is the
 * lower-bound for "last 7 days" buckets (today + previous 6 days).
 */
export function startOfDaysAgo(n: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - n);
  return d;
}

/**
 * True if the UTC DB timestamp falls on today's calendar day in the user's
 * local timezone. Returns false for missing or unparseable input.
 */
export function isToday(utcTimestamp: string): boolean {
  const t = parseDbTs(utcTimestamp);
  if (!Number.isFinite(t)) return false;
  const start = startOfToday().getTime();
  const end = start + 24 * 3600_000;
  return t >= start && t < end;
}

/**
 * True if the UTC DB timestamp falls within the last `n` calendar days in
 * the user's local timezone — i.e. between midnight of `n - 1` days ago and
 * the current moment. `isWithinDays(ts, 1)` is equivalent to `isToday(ts)`.
 * Returns false for missing or unparseable input.
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
