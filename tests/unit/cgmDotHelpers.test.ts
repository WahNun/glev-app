// Unit coverage for the CGM live-dot injection helpers (lib/cgm/cgmDotHelpers).
//
// Task background: Task #1211 fixed the chart dot showing the last history
// point instead of the live `officialCurrent` reading when that reading is
// newer. Task #1213 added guardCgmCurrentForward so a stale cache hit cannot
// flip the dot to an older value than what was already displayed.
//
// Pure-function tests — no DB, no network, no Next.js runtime.

import { test, expect } from "@playwright/test";
import {
  pickCgmCurrentBase,
  injectCurrentPoint,
  guardCgmCurrentForward,
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

// ── guardCgmCurrentForward ────────────────────────────────────────────────────

test("guardCgmCurrentForward: no prev → accepts next as-is", () => {
  const next: CgmPoint = { t: min(10), v: 118 };
  expect(guardCgmCurrentForward(null, next)).toEqual(next);
});

test("guardCgmCurrentForward: no next → returns prev unchanged", () => {
  const prev: CgmPoint = { t: min(10), v: 118 };
  expect(guardCgmCurrentForward(prev, null)).toEqual(prev);
});

test("guardCgmCurrentForward: both null → null", () => {
  expect(guardCgmCurrentForward(null, null)).toBeNull();
});

test("guardCgmCurrentForward: next newer than prev → accepts next", () => {
  const prev: CgmPoint = { t: min(10), v: 118 };
  const next: CgmPoint = { t: min(15), v: 122 };
  expect(guardCgmCurrentForward(prev, next)).toEqual(next);
});

test("guardCgmCurrentForward: next older than prev → keeps prev (no backward flip)", () => {
  const prev: CgmPoint = { t: min(15), v: 122 };
  const next: CgmPoint = { t: min(10), v: 118 }; // stale cache hit
  expect(guardCgmCurrentForward(prev, next)).toEqual(prev);
});

test("guardCgmCurrentForward: same timestamp → accepts next (equal is not backward)", () => {
  const prev: CgmPoint = { t: min(10), v: 118 };
  const next: CgmPoint = { t: min(10), v: 118 };
  expect(guardCgmCurrentForward(prev, next)).toEqual(next);
});

// ── Race scenario: stale history cache while officialCurrent is already fresh ──
//
// Task #1213 scenario: the 30-second client cache returns a snapshot where
// the history array ends at an earlier point (stale) while a previous render
// had already picked and displayed a fresher officialCurrent. Without the
// guard, pickCgmCurrentBase on the stale snapshot returns the old history
// tail, moving the dot backward. guardCgmCurrentForward prevents this.

test("race: stale cache history, fresh officialCurrent already known → dot stays at known value", () => {
  // Round 1: fresh network response — history ends at T+20, officialCurrent at T+25.
  const round1History = makeHistory([95, 100, 105, 108]); // last point at min(15)
  const round1Official: CgmPoint = { t: min(25), v: 122 };
  const round1Raw = pickCgmCurrentBase(round1Official, round1History);
  // Simulate the ref starting at null (first load).
  const afterRound1 = guardCgmCurrentForward(null, round1Raw);
  // Should be the officialCurrent (newer than history).
  expect(afterRound1).toEqual(round1Official);

  // Round 2: cache returns a STALE snapshot — same history but officialCurrent
  // has gone missing or reverted to an older value (e.g. the cache returned
  // a 30-second-old entry captured before the fresh officialCurrent arrived).
  const staleCacheHistory = makeHistory([95, 100, 105]); // shorter / older
  const staleOfficial: CgmPoint = { t: min(5), v: 101 }; // ancient
  const round2Raw = pickCgmCurrentBase(staleOfficial, staleCacheHistory);
  // Raw pick would be the last stale history entry (min(10), v=105) since
  // it is newer than staleOfficial (min(5)).
  expect(round2Raw!.t).toBeLessThan(afterRound1!.t);

  // Guard: uses afterRound1 as prev — refuses to go backward.
  const afterRound2 = guardCgmCurrentForward(afterRound1, round2Raw);
  expect(afterRound2).toEqual(round1Official); // dot does NOT move backward
});

test("race: stale officialCurrent while history already showed newer point → dot stays at history value", () => {
  // Round 1: history is fresher than officialCurrent.
  const freshHistory = makeHistory([100, 108, 115]); // last point at min(10)
  const staleOfficial1: CgmPoint = { t: min(-540), v: 90 }; // 9h stale
  const raw1 = pickCgmCurrentBase(staleOfficial1, freshHistory);
  const after1 = guardCgmCurrentForward(null, raw1);
  expect(after1).toEqual(freshHistory[freshHistory.length - 1]);

  // Round 2: cache returns a snapshot where the history has FEWER points
  // (older cache) and the officialCurrent is still stale.
  const olderHistory = makeHistory([100, 108]); // one entry shorter
  const staleOfficial2: CgmPoint = { t: min(-600), v: 88 };
  const raw2 = pickCgmCurrentBase(staleOfficial2, olderHistory);
  const after2 = guardCgmCurrentForward(after1, raw2);

  // Guard: the stale cache's "best pick" is older than what we already showed.
  expect(after2).toEqual(after1); // dot stays at the fresher value
});

test("race: sequential loads — dot only advances, never retreats", () => {
  // Simulate 4 loadHistory() rounds. In some rounds the cache is stale.
  // The guard should produce a monotonically non-decreasing timestamp sequence.
  const rounds: Array<{ cgm: CgmPoint[]; official: CgmPoint | null }> = [
    { cgm: makeHistory([100, 105]),           official: { t: min(10), v: 107 } }, // fresh
    { cgm: makeHistory([100, 105]),           official: { t: min(3),  v: 101 } }, // stale official (cache hit)
    { cgm: makeHistory([100, 105, 109, 112]), official: { t: min(10), v: 107 } }, // fresh history
    { cgm: makeHistory([100]),               official: null },                    // very stale cache
  ];

  let knownCurrent: CgmPoint | null = null;
  const dotTimestamps: number[] = [];

  for (const round of rounds) {
    const raw = pickCgmCurrentBase(round.official, round.cgm);
    knownCurrent = guardCgmCurrentForward(knownCurrent, raw);
    if (knownCurrent) dotTimestamps.push(knownCurrent.t);
  }

  // Verify each timestamp is >= the previous one (monotonically non-decreasing).
  for (let i = 1; i < dotTimestamps.length; i++) {
    expect(dotTimestamps[i]).toBeGreaterThanOrEqual(dotTimestamps[i - 1]);
  }
});
