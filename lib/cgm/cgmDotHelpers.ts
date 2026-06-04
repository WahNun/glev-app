/**
 * Pure helpers for the CGM live-dot injection.
 *
 * The chart always needs its rightmost data point to match the large
 * "current value" shown in the hero number. These functions are extracted
 * from CurrentDayGlucoseCard so they can be unit-tested independently.
 *
 * See also: the cgmWithCurrent injection block in CurrentDayGlucoseCard.tsx
 * and tests/unit/cgmDotHelpers.test.ts.
 */

/** Minimal shape used by both the chart and these helpers. */
export type CgmPoint = { t: number; v: number };

/**
 * Picks the best "current" CGM reading to display in the hero number and
 * use as the live dot.
 *
 * LLU's `connection.glucoseMeasurement` (officialCurrent) sometimes lags
 * by hours while `graphData` (the history array) is already fresh. If
 * the newest history point is strictly newer we prefer it; otherwise we
 * prefer the official current value. Either side may be null when there
 * is no data (newly connected sensor, first load, etc.).
 */
export function pickCgmCurrentBase(
  officialCurrent: CgmPoint | null,
  cgm: CgmPoint[]
): CgmPoint | null {
  const newestHistory: CgmPoint | null = cgm.length ? cgm[cgm.length - 1] : null;
  if (officialCurrent && newestHistory) {
    return newestHistory.t > officialCurrent.t ? newestHistory : officialCurrent;
  }
  return officialCurrent ?? newestHistory ?? null;
}

/**
 * Appends `current` to the sorted CGM history array when it is strictly
 * newer than the last entry, so the chart dot always reflects the live
 * reading rather than the final polled history point.
 *
 * • If `current` is null/undefined → returns `cgm` unchanged.
 * • If `current.t` is already the last entry's timestamp → no duplicate is
 *   added (the history array already contains it).
 * • If `current.t > lastHistoryT` → the current point is appended so the
 *   rightmost dot on the chart matches the displayed value.
 */
export function injectCurrentPoint(
  cgm: CgmPoint[],
  current: CgmPoint | null | undefined
): CgmPoint[] {
  if (!current) return cgm;
  const lastT = cgm.length ? cgm[cgm.length - 1].t : -Infinity;
  return current.t > lastT ? [...cgm, { t: current.t, v: current.v }] : cgm;
}
