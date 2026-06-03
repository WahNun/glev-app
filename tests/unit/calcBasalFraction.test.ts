/**
 * Unit tests for calcBasalFraction (lib/iob.ts).
 *
 * calcBasalFraction implements a two-phase piecewise linear decay:
 *
 *  • Plateau phase  (0 … windowMin × peakFraction):
 *    Slow decay — rate = 0.5 / windowMin.
 *    Ring still shrinks, but noticeably slower than the tail phase.
 *
 *  • Tail phase  (windowMin × peakFraction … windowMin):
 *    Faster decay from midValue → 0.
 *    midValue = 1 − peakFraction × 0.5
 *
 * Example with WINDOW=1440, peakFraction=0.6:
 *   t=0    → 1.00   (just injected)
 *   t=864  → 0.70   (plateau end / tail start)
 *   t=1440 → 0.00   (window expired)
 *   tail rate ≈ 3.5× plateau rate
 */

import { test, expect } from "@playwright/test";
import { calcBasalFraction } from "@/lib/iob";

// Standard test parameters: 24 h window, 60 % plateau
const WINDOW   = 1440; // minutes (24 h)
const PEAK_F   = 0.60; // plateau ends at 864 min (14.4 h)
const PEAK_END = WINDOW * PEAK_F; // 864
// midValue: ring fraction at the plateau/tail boundary
const MID_VAL  = 1 - PEAK_F * 0.5; // 0.70

// ── Boundary: start and end of window ────────────────────────────────────────

test("calcBasalFraction: elapsedMin = 0 → 1.0 (just injected)", () => {
  expect(calcBasalFraction(0, WINDOW, PEAK_F)).toBe(1);
});

test("calcBasalFraction: elapsedMin = windowMin → 0 (window fully expired)", () => {
  expect(calcBasalFraction(WINDOW, WINDOW, PEAK_F)).toBe(0);
});

test("calcBasalFraction: elapsedMin > windowMin → 0 (overdue)", () => {
  expect(calcBasalFraction(WINDOW + 60, WINDOW, PEAK_F)).toBe(0);
  expect(calcBasalFraction(WINDOW * 2,  WINDOW, PEAK_F)).toBe(0);
});

test("calcBasalFraction: elapsedMin < 0 → 1.0 (future dose)", () => {
  expect(calcBasalFraction(-1,   WINDOW, PEAK_F)).toBe(1);
  expect(calcBasalFraction(-120, WINDOW, PEAK_F)).toBe(1);
});

// ── Plateau/tail boundary ─────────────────────────────────────────────────────

test("calcBasalFraction: at plateau end → midValue (0.70 for peakFraction=0.6)", () => {
  expect(calcBasalFraction(PEAK_END, WINDOW, PEAK_F)).toBeCloseTo(MID_VAL, 10);
});

test("calcBasalFraction: one minute before plateau end → slightly above midValue", () => {
  const result = calcBasalFraction(PEAK_END - 1, WINDOW, PEAK_F);
  expect(result).toBeGreaterThan(MID_VAL);
  expect(result).toBeLessThan(1);
});

test("calcBasalFraction: one minute after plateau end → slightly below midValue", () => {
  const result = calcBasalFraction(PEAK_END + 1, WINDOW, PEAK_F);
  expect(result).toBeGreaterThan(0);
  expect(result).toBeLessThan(MID_VAL);
});

test("calcBasalFraction: no discontinuity at plateau boundary (value is continuous)", () => {
  const before = calcBasalFraction(PEAK_END - 0.001, WINDOW, PEAK_F);
  const at     = calcBasalFraction(PEAK_END,         WINDOW, PEAK_F);
  const after  = calcBasalFraction(PEAK_END + 0.001, WINDOW, PEAK_F);
  // All three should be within 0.001 of each other
  expect(Math.abs(before - at)).toBeLessThan(0.001);
  expect(Math.abs(at - after)).toBeLessThan(0.001);
});

// ── Plateau phase decays slowly ───────────────────────────────────────────────

test("calcBasalFraction: values inside plateau are strictly between midValue and 1.0", () => {
  const samples = 10;
  // Exclude t=0 (=1.0) and t=PEAK_END (=midValue); test interior points only
  for (let i = 1; i < samples; i++) {
    const t = (PEAK_END * i) / samples;
    const v = calcBasalFraction(t, WINDOW, PEAK_F);
    expect(v).toBeGreaterThan(MID_VAL);
    expect(v).toBeLessThan(1);
  }
});

test("calcBasalFraction: plateau values strictly decrease with time", () => {
  const early = calcBasalFraction(PEAK_END * 0.25, WINDOW, PEAK_F);
  const mid   = calcBasalFraction(PEAK_END * 0.50, WINDOW, PEAK_F);
  const late  = calcBasalFraction(PEAK_END * 0.75, WINDOW, PEAK_F);
  expect(early).toBeGreaterThan(mid);
  expect(mid).toBeGreaterThan(late);
});

// ── Tail phase decays faster ──────────────────────────────────────────────────

test("calcBasalFraction: tail values strictly between 0 and midValue", () => {
  const samples = 5;
  for (let i = 1; i < samples; i++) {
    const t = PEAK_END + ((WINDOW - PEAK_END) * i) / samples;
    const v = calcBasalFraction(t, WINDOW, PEAK_F);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(MID_VAL);
  }
});

test("calcBasalFraction: tail rate is noticeably faster than plateau rate", () => {
  // Compare per-minute drop: sample 1 minute in each phase
  const plateauDrop = calcBasalFraction(0, WINDOW, PEAK_F) -
                      calcBasalFraction(1, WINDOW, PEAK_F);
  const tailDrop    = calcBasalFraction(PEAK_END,     WINDOW, PEAK_F) -
                      calcBasalFraction(PEAK_END + 1, WINDOW, PEAK_F);
  // Tail should drop at least 2× faster per minute than the plateau
  expect(tailDrop).toBeGreaterThan(plateauDrop * 2);
});

test("calcBasalFraction: tail midpoint ≈ midValue × 0.5", () => {
  const tailMid = PEAK_END + (WINDOW - PEAK_END) / 2;
  // Linear tail → midpoint = midValue / 2
  expect(calcBasalFraction(tailMid, WINDOW, PEAK_F)).toBeCloseTo(MID_VAL / 2, 5);
});

// ── Different peakFraction ────────────────────────────────────────────────────

test("calcBasalFraction: peakFraction=0.75 — midValue = 0.625", () => {
  const pf      = 0.75;
  const peakEnd = WINDOW * pf;       // 1080 min
  const midVal  = 1 - pf * 0.5;     // 0.625

  expect(calcBasalFraction(peakEnd, WINDOW, pf)).toBeCloseTo(midVal, 10);

  const halfTail = peakEnd + (WINDOW - peakEnd) / 2;
  expect(calcBasalFraction(halfTail, WINDOW, pf)).toBeCloseTo(midVal / 2, 5);

  expect(calcBasalFraction(WINDOW, WINDOW, pf)).toBe(0);
});

// ── Different window length ───────────────────────────────────────────────────

test("calcBasalFraction: 8 h window (480 min), peakFraction=0.5", () => {
  const win  = 480;
  const pf   = 0.5;
  const pEnd = win * pf;         // 240 min
  const mid  = 1 - pf * 0.5;    // 0.75

  expect(calcBasalFraction(0,    win, pf)).toBe(1);
  expect(calcBasalFraction(pEnd, win, pf)).toBeCloseTo(mid, 10);

  // 1 min into tail → just below midValue
  const afterPlat = calcBasalFraction(pEnd + 1, win, pf);
  expect(afterPlat).toBeGreaterThan(0);
  expect(afterPlat).toBeLessThan(mid);

  expect(calcBasalFraction(win,      win, pf)).toBe(0);
  expect(calcBasalFraction(win + 60, win, pf)).toBe(0);
});
