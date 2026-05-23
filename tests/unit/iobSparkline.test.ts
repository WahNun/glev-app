// Regression guard for the IOB sparkline invisible-curve bug (Task #539).
//
// The bug: when multiple doses were logged, an early-morning dose stretched
// the X-axis so far that a later, still-active dose occupied only 1–2 px and
// became visually invisible.
//
// The fix (IOBCard.tsx IOBSparkline) filters doses down to only "active" ones
// (not yet cleared at `now`) before computing the time window. When everything
// has cleared it falls back to all doses so the full decay curve is still shown.
//
// The pure function `calcSparklineWindow` (lib/iob.ts) was extracted from the
// React component so this invariant can be exercised without a browser/renderer.
//
// Scenarios covered:
//   1. Single active dose  — window spans exactly that dose's DIA period.
//   2. One cleared + one active dose  — window covers only the active dose.
//   3. All doses cleared  — window falls back to all doses.
//   4. nowX sits within [0, W] in all cases.

import { test, expect } from "@playwright/test";
import { calcSparklineWindow } from "@/lib/iob";
import type { BolusDose } from "@/lib/iob";

// SVG width used in IOBSparkline — kept in sync with the component constant.
const W = 220;

// ── helpers ──────────────────────────────────────────────────────────────────

function msAgo(minutes: number): number {
  return Date.now() - minutes * 60_000;
}

function isoAgo(minutes: number): string {
  return new Date(msAgo(minutes)).toISOString();
}

function makeDose(minutesAgo: number, units = 4): BolusDose {
  return { units, administeredAt: isoAgo(minutesAgo) };
}

/** Computes the nowX position the sparkline would draw for the given window. */
function calcNowX(nowMs: number, earliestMs: number, totalDurationMs: number): number {
  return Math.max(0, Math.min(W, ((nowMs - earliestMs) / totalDurationMs) * W));
}

// ── 1. Single active dose ────────────────────────────────────────────────────
//
// Only one dose, given 30 minutes ago, DIA = 180 min → still active.
// The window must span from that dose's start to its clearance time.

test("calcSparklineWindow: single active dose — window spans dose start to clearance", () => {
  const diaMin = 180;
  const doseMsAgo = 30;
  const dose = makeDose(doseMsAgo);
  const nowMs = Date.now();
  const doseMs = new Date(dose.administeredAt).getTime();

  const win = calcSparklineWindow([dose], diaMin, nowMs);

  expect(win.windowDoses).toHaveLength(1);
  expect(win.windowDoses[0]).toBe(dose);

  // earliestMs must match the dose timestamp (within floating-point tolerance).
  expect(win.earliestMs).toBeCloseTo(doseMs, -1);

  // latestClearanceMs must be exactly one DIA period after the dose.
  expect(win.latestClearanceMs).toBeCloseTo(doseMs + diaMin * 60_000, -1);

  // totalDurationMs == diaMin in minutes.
  expect(win.totalDurationMs).toBeCloseTo(diaMin * 60_000, -1);
});

test("calcSparklineWindow: single active dose — nowX is strictly inside SVG width", () => {
  const diaMin = 180;
  const dose = makeDose(30); // 30 min ago → mid-curve
  const nowMs = Date.now();

  const win = calcSparklineWindow([dose], diaMin, nowMs);
  const nowX = calcNowX(nowMs, win.earliestMs, win.totalDurationMs);

  expect(nowX).toBeGreaterThanOrEqual(0);
  expect(nowX).toBeLessThanOrEqual(W);
  // "now" is 30 min into a 180-min DIA → should be somewhere in the left third.
  expect(nowX).toBeGreaterThan(0);
  expect(nowX).toBeLessThan(W);
});

// ── 2. One cleared + one active dose ────────────────────────────────────────
//
// Dose A administered 200 min ago (beyond DIA 180) → cleared.
// Dose B administered 30 min ago → still active.
// The window must cover ONLY Dose B so Dose B isn't squashed into 1–2 px.
// This is the exact regression from Task #539.

test("calcSparklineWindow: one cleared + one active — window uses only the active dose", () => {
  const diaMin = 180;
  const cleared = makeDose(200); // 200 min ago → beyond DIA → cleared
  const active  = makeDose(30);  // 30 min ago → still active
  const nowMs = Date.now();

  const win = calcSparklineWindow([cleared, active], diaMin, nowMs);

  // Window must exclude the cleared dose.
  expect(win.windowDoses).toHaveLength(1);
  expect(win.windowDoses[0]).toBe(active);
});

test("calcSparklineWindow: cleared dose does NOT stretch the window start", () => {
  const diaMin = 180;
  const cleared = makeDose(200);
  const active  = makeDose(30);
  const nowMs = Date.now();

  const winWithBoth  = calcSparklineWindow([cleared, active], diaMin, nowMs);
  const winActiveOnly = calcSparklineWindow([active],          diaMin, nowMs);

  // The two-dose window and the single-active-dose window must agree on earliestMs.
  expect(winWithBoth.earliestMs).toBeCloseTo(winActiveOnly.earliestMs, -1);
  expect(winWithBoth.totalDurationMs).toBeCloseTo(winActiveOnly.totalDurationMs, -1);
});

test("calcSparklineWindow: cleared + active — nowX is within SVG bounds", () => {
  const diaMin = 180;
  const cleared = makeDose(200);
  const active  = makeDose(30);
  const nowMs = Date.now();

  const win  = calcSparklineWindow([cleared, active], diaMin, nowMs);
  const nowX = calcNowX(nowMs, win.earliestMs, win.totalDurationMs);

  expect(nowX).toBeGreaterThanOrEqual(0);
  expect(nowX).toBeLessThanOrEqual(W);
});

test("calcSparklineWindow: cleared + active — nowX corresponds to a non-trivial x position", () => {
  // The "now" marker should appear well inside the SVG (not collapsed to 0 or W),
  // proving the active dose isn't invisible.
  const diaMin = 180;
  const cleared = makeDose(200);
  const active  = makeDose(30);
  const nowMs = Date.now();

  const win  = calcSparklineWindow([cleared, active], diaMin, nowMs);
  const nowX = calcNowX(nowMs, win.earliestMs, win.totalDurationMs);

  // 30 min into 180 min DIA → nowX ≈ W * (30/180) ≈ 36–37 px — clearly visible.
  expect(nowX).toBeGreaterThan(10);
  expect(nowX).toBeLessThan(W - 10);
});

// ── 3. All doses cleared ─────────────────────────────────────────────────────
//
// Both doses are beyond DIA. The active filter returns nothing, so the window
// falls back to ALL doses. This keeps the historical curve visible.

test("calcSparklineWindow: all doses cleared — window falls back to all doses", () => {
  const diaMin = 180;
  const dose1 = makeDose(200); // beyond DIA
  const dose2 = makeDose(250); // beyond DIA
  const nowMs = Date.now();

  const win = calcSparklineWindow([dose1, dose2], diaMin, nowMs);

  // Fallback: all doses
  expect(win.windowDoses).toHaveLength(2);
  expect(win.windowDoses).toContain(dose1);
  expect(win.windowDoses).toContain(dose2);
});

test("calcSparklineWindow: all doses cleared — earliestMs uses the oldest dose", () => {
  const diaMin = 180;
  const dose1 = makeDose(200);
  const dose2 = makeDose(250); // older
  const nowMs = Date.now();

  const win = calcSparklineWindow([dose1, dose2], diaMin, nowMs);

  const dose2Ms = new Date(dose2.administeredAt).getTime();
  expect(win.earliestMs).toBeCloseTo(dose2Ms, -1);
});

test("calcSparklineWindow: all doses cleared — latestClearanceMs is after both doses clear", () => {
  const diaMin = 180;
  const dose1 = makeDose(200);
  const dose2 = makeDose(250);
  const nowMs = Date.now();

  const win = calcSparklineWindow([dose1, dose2], diaMin, nowMs);

  const dose1ClearMs = new Date(dose1.administeredAt).getTime() + diaMin * 60_000;
  const dose2ClearMs = new Date(dose2.administeredAt).getTime() + diaMin * 60_000;
  const expectedClearance = Math.max(dose1ClearMs, dose2ClearMs);

  expect(win.latestClearanceMs).toBeCloseTo(expectedClearance, -1);
});

test("calcSparklineWindow: all doses cleared — nowX is within SVG bounds", () => {
  const diaMin = 180;
  const dose1 = makeDose(200);
  const dose2 = makeDose(250);
  const nowMs = Date.now();

  const win  = calcSparklineWindow([dose1, dose2], diaMin, nowMs);
  const nowX = calcNowX(nowMs, win.earliestMs, win.totalDurationMs);

  // "now" is after both doses cleared → nowX is at or past the end of the window.
  expect(nowX).toBeGreaterThanOrEqual(0);
  expect(nowX).toBeLessThanOrEqual(W);
});

// ── 4. nowX invariant — never outside [0, W] across edge cases ───────────────

test("calcSparklineWindow: nowX clamps to 0 when now is before the window start", () => {
  const diaMin = 180;
  // Dose administered in the future → now is before the window start.
  const futureDose: BolusDose = {
    units: 4,
    administeredAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
  const nowMs = Date.now();

  const win  = calcSparklineWindow([futureDose], diaMin, nowMs);
  const nowX = calcNowX(nowMs, win.earliestMs, win.totalDurationMs);

  expect(nowX).toBe(0);
});

test("calcSparklineWindow: nowX clamps to W when now is beyond the clearance time", () => {
  const diaMin = 180;
  // Dose given 300 min ago (well past clearance) — fallback window used.
  const dose = makeDose(300);
  const nowMs = Date.now();

  const win  = calcSparklineWindow([dose], diaMin, nowMs);
  const nowX = calcNowX(nowMs, win.earliestMs, win.totalDurationMs);

  expect(nowX).toBe(W);
});

test("calcSparklineWindow: totalDurationMs is always >= 1 (no division by zero)", () => {
  // Edge case: a single dose with an identical start and clearance time
  // is prevented by the Math.max(…, 1) guard.
  const diaMin = 180;
  const dose = makeDose(30);
  const nowMs = Date.now();

  const win = calcSparklineWindow([dose], diaMin, nowMs);

  expect(win.totalDurationMs).toBeGreaterThanOrEqual(1);
});

// ── 5. Three-dose scenario: two cleared, one active ───────────────────────────
//
// Makes sure the window uses exactly the one active dose even when multiple
// cleared doses are present — this is a common real-world scenario (breakfast +
// lunch already cleared, dinner is the active dose at the time of logging).

test("calcSparklineWindow: two cleared + one active — window uses only the active dose", () => {
  const diaMin = 180;
  const breakfast = makeDose(500); // cleared
  const lunch     = makeDose(300); // cleared
  const dinner    = makeDose(45);  // active
  const nowMs = Date.now();

  const win = calcSparklineWindow([breakfast, lunch, dinner], diaMin, nowMs);

  expect(win.windowDoses).toHaveLength(1);
  expect(win.windowDoses[0]).toBe(dinner);
});

test("calcSparklineWindow: two active doses — both included in window", () => {
  const diaMin = 180;
  const dose1 = makeDose(30);  // active
  const dose2 = makeDose(90);  // active (still within 180 min DIA)
  const nowMs = Date.now();

  const win = calcSparklineWindow([dose1, dose2], diaMin, nowMs);

  expect(win.windowDoses).toHaveLength(2);
  expect(win.windowDoses).toContain(dose1);
  expect(win.windowDoses).toContain(dose2);
});

test("calcSparklineWindow: two active doses — window spans from the earliest to the latest clearance", () => {
  const diaMin = 180;
  const dose1 = makeDose(30);  // will clear in 150 min
  const dose2 = makeDose(90);  // will clear in 90 min → dose1 clears later
  const nowMs = Date.now();

  const win = calcSparklineWindow([dose1, dose2], diaMin, nowMs);

  // Earliest is dose2 (given 90 min ago).
  const dose2Ms = new Date(dose2.administeredAt).getTime();
  expect(win.earliestMs).toBeCloseTo(dose2Ms, -1);

  // Clearance is dose1's clearance (given 30 min ago → clears in 150 more min).
  const dose1ClearMs = new Date(dose1.administeredAt).getTime() + diaMin * 60_000;
  expect(win.latestClearanceMs).toBeCloseTo(dose1ClearMs, -1);
});
