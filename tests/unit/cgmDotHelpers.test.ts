// Unit coverage for the CGM live-dot injection helpers (lib/cgm/cgmDotHelpers).
//
// Task background: Task #1210 fixed the chart dot showing the last history
// point instead of the live `officialCurrent` reading when that reading is
// newer. These tests lock in that fix so a future removal of the injection
// block is caught immediately.
//
// Pure-function tests — no DB, no network, no Next.js runtime.

import { test, expect } from "@playwright/test";
import {
  pickCgmCurrentBase,
  injectCurrentPoint,
  type CgmPoint,
} from "@/lib/cgm/cgmDotHelpers";

// ── Helpers ──────────────────────────────────────────────────────────────────

const T0 = Date.parse("2026-06-04T08:00:00Z");
const min = (n: number) => T0 + n * 60_000;

function makeHistory(values: number[], stepMin = 5): CgmPoint[] {
  return values.map((v, i) => ({ t: T0 + i * stepMin * 60_000, v }));
}

// ── pickCgmCurrentBase ────────────────────────────────────────────────────────

test("pickCgmCurrentBase: officialCurrent newer than history → officialCurrent wins", () => {
  const cgm = makeHistory([100, 105, 110]);
  // officialCurrent arrived 2 min after the last history point
  const official: CgmPoint = { t: min(12), v: 115 };
  const result = pickCgmCurrentBase(official, cgm);
  expect(result).toEqual(official);
});

test("pickCgmCurrentBase: history newer than officialCurrent → history wins", () => {
  const cgm = makeHistory([100, 105, 110]);
  // officialCurrent is 9 hours stale (Lucas's real-world scenario 2026-05-12)
  const staleOfficial: CgmPoint = { t: min(-9 * 60), v: 90 };
  const result = pickCgmCurrentBase(staleOfficial, cgm);
  expect(result).toEqual(cgm[cgm.length - 1]);
});

test("pickCgmCurrentBase: officialCurrent same timestamp as newest history → officialCurrent wins (not newer, equal)", () => {
  const cgm = makeHistory([100, 105, 110]);
  const last = cgm[cgm.length - 1];
  const official: CgmPoint = { t: last.t, v: 112 };
  // newestHistory.t is NOT > officialCurrent.t, so officialCurrent is picked
  const result = pickCgmCurrentBase(official, cgm);
  expect(result).toEqual(official);
});

test("pickCgmCurrentBase: empty history + officialCurrent → officialCurrent", () => {
  const official: CgmPoint = { t: T0, v: 108 };
  expect(pickCgmCurrentBase(official, [])).toEqual(official);
});

test("pickCgmCurrentBase: non-empty history + null officialCurrent → last history point", () => {
  const cgm = makeHistory([100, 105]);
  expect(pickCgmCurrentBase(null, cgm)).toEqual(cgm[cgm.length - 1]);
});

test("pickCgmCurrentBase: both null → null", () => {
  expect(pickCgmCurrentBase(null, [])).toBeNull();
});

// ── injectCurrentPoint ────────────────────────────────────────────────────────

test("injectCurrentPoint: current newer than last history → appended as final entry", () => {
  const cgm = makeHistory([100, 105, 110]);
  const current: CgmPoint = { t: min(16), v: 118 };
  const result = injectCurrentPoint(cgm, current);
  // Array should be one entry longer
  expect(result).toHaveLength(cgm.length + 1);
  // The final dot must carry the officialCurrent value
  expect(result[result.length - 1]).toEqual(current);
});

test("injectCurrentPoint: current SAME timestamp as last history → no duplicate", () => {
  const cgm = makeHistory([100, 105, 110]);
  const last = cgm[cgm.length - 1];
  // Same timestamp, different value — should NOT inject
  const current: CgmPoint = { t: last.t, v: last.v + 3 };
  const result = injectCurrentPoint(cgm, current);
  expect(result).toHaveLength(cgm.length);
  expect(result[result.length - 1]).toEqual(last);
});

test("injectCurrentPoint: current OLDER than last history point → no change", () => {
  const cgm = makeHistory([100, 105, 110]);
  const stale: CgmPoint = { t: min(-10), v: 80 };
  const result = injectCurrentPoint(cgm, stale);
  expect(result).toHaveLength(cgm.length);
  expect(result[result.length - 1]).toEqual(cgm[cgm.length - 1]);
});

test("injectCurrentPoint: empty history + current → single-entry array with current", () => {
  const current: CgmPoint = { t: T0, v: 108 };
  const result = injectCurrentPoint([], current);
  expect(result).toHaveLength(1);
  expect(result[0]).toEqual(current);
});

test("injectCurrentPoint: null current → original array returned unchanged", () => {
  const cgm = makeHistory([100, 105, 110]);
  const result = injectCurrentPoint(cgm, null);
  expect(result).toBe(cgm); // same reference, not a copy
});

test("injectCurrentPoint: undefined current → original array returned unchanged", () => {
  const cgm = makeHistory([100, 105]);
  const result = injectCurrentPoint(cgm, undefined);
  expect(result).toBe(cgm);
});

// ── Integration: full injection path (mirrors CurrentDayGlucoseCard logic) ──

test("full injection path: officialCurrent newer than history → dot value matches officialCurrent", () => {
  // Simulates the exact two-step flow in CurrentDayGlucoseCard.tsx:
  // 1. pickCgmCurrentBase selects the freshest source
  // 2. injectCurrentPoint appends it when it's strictly newer
  const historyValues = [95, 100, 105, 108];
  const cgm = makeHistory(historyValues);

  const officialCurrent: CgmPoint = { t: min(historyValues.length * 5 + 2), v: 112 };

  const cgmCurrentBase = pickCgmCurrentBase(officialCurrent, cgm);
  const cgmWithCurrent = injectCurrentPoint(cgm, cgmCurrentBase);

  // The rightmost dot must carry the officialCurrent value
  const dot = cgmWithCurrent[cgmWithCurrent.length - 1];
  expect(dot.v).toBe(officialCurrent.v);
  expect(dot.t).toBe(officialCurrent.t);
});

test("full injection path: stale officialCurrent → dot value matches newest history point", () => {
  const historyValues = [95, 100, 105, 108];
  const cgm = makeHistory(historyValues);

  const staleOfficial: CgmPoint = { t: min(-60), v: 85 };

  const cgmCurrentBase = pickCgmCurrentBase(staleOfficial, cgm);
  const cgmWithCurrent = injectCurrentPoint(cgm, cgmCurrentBase);

  // History is already the freshest source; no new entry is appended
  const dot = cgmWithCurrent[cgmWithCurrent.length - 1];
  expect(dot.v).toBe(cgm[cgm.length - 1].v);
  expect(cgmWithCurrent).toHaveLength(cgm.length);
});

test("regression guard: injection removed → dot is last history point, not officialCurrent", () => {
  // This test documents what the bug looked like before the fix and
  // confirms the helpers exist and produce the correct shape.
  // If injectCurrentPoint were deleted and replaced by `return cgm`, this
  // test would catch the regression because the dot.v would equal 108 (last
  // history point) instead of 115 (officialCurrent).
  const cgm = makeHistory([95, 100, 105, 108]);
  const officialCurrent: CgmPoint = { t: min(22), v: 115 };

  const base = pickCgmCurrentBase(officialCurrent, cgm);
  const withCurrent = injectCurrentPoint(cgm, base);

  expect(withCurrent[withCurrent.length - 1].v).toBe(115);
  expect(withCurrent[withCurrent.length - 1].v).not.toBe(108);
});
