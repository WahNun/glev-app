/**
 * Unit tests for calcBasalFraction (lib/iob.ts).
 *
 * calcBasalFraction implements a two-phase pharmacokinetic model:
 *
 *  • Plateau phase  (0 … windowMin × peakFraction):
 *    Ring stays at 1.0 — insulin is fully effective, no decay shown.
 *
 *  • Tail phase  (windowMin × peakFraction … windowMin):
 *    Linear decay from 1.0 → 0 — insulin is wearing off.
 *
 * All six boundary conditions from Task #726 are covered:
 *  1. elapsedMin = 0                          → 1.0
 *  2. elapsedMin = windowMin × peakFraction   → 1.0 (plateau boundary)
 *  3. elapsedMin slightly past plateau end    → slightly below 1.0
 *  4. elapsedMin = windowMin                  → 0
 *  5. elapsedMin > windowMin                  → 0
 *  6. elapsedMin < 0 (future dose)            → 1.0
 */

import { test, expect } from "@playwright/test";
import { calcBasalFraction } from "@/lib/iob";

// Standard test parameters: 24 h window, 60 % plateau
const WINDOW  = 1440; // minutes (24 h)
const PEAK_F  = 0.60; // plateau ends at 864 min (14.4 h)
const PEAK_END = WINDOW * PEAK_F; // 864

// ── 1. Exactly at injection time ─────────────────────────────────────────────

test("calcBasalFraction: elapsedMin = 0 → 1.0 (just injected)", () => {
  expect(calcBasalFraction(0, WINDOW, PEAK_F)).toBe(1);
});

// ── 2. Exactly at plateau end ────────────────────────────────────────────────

test("calcBasalFraction: elapsedMin = windowMin × peakFraction → 1.0 (plateau boundary)", () => {
  expect(calcBasalFraction(PEAK_END, WINDOW, PEAK_F)).toBe(1);
});

// ── 3. Slightly past the plateau end → just below 1.0 ───────────────────────

test("calcBasalFraction: one minute past plateau end → just below 1.0", () => {
  const epsilon = 1; // 1 minute into the tail
  const result  = calcBasalFraction(PEAK_END + epsilon, WINDOW, PEAK_F);
  expect(result).toBeGreaterThan(0);
  expect(result).toBeLessThan(1);
});

test("calcBasalFraction: tail values strictly decrease with time", () => {
  const tailStart = PEAK_END + 1;
  const mid       = PEAK_END + (WINDOW - PEAK_END) / 2;

  const early = calcBasalFraction(tailStart, WINDOW, PEAK_F);
  const later = calcBasalFraction(mid,       WINDOW, PEAK_F);

  expect(early).toBeGreaterThan(later);
});

// ── 4. Exactly at window end → 0 ────────────────────────────────────────────

test("calcBasalFraction: elapsedMin = windowMin → 0 (window fully expired)", () => {
  expect(calcBasalFraction(WINDOW, WINDOW, PEAK_F)).toBe(0);
});

// ── 5. Past window end → 0 ──────────────────────────────────────────────────

test("calcBasalFraction: elapsedMin > windowMin → 0 (overdue)", () => {
  expect(calcBasalFraction(WINDOW + 60, WINDOW, PEAK_F)).toBe(0);
  expect(calcBasalFraction(WINDOW * 2,  WINDOW, PEAK_F)).toBe(0);
});

// ── 6. Negative elapsed (future dose) → 1.0 ─────────────────────────────────

test("calcBasalFraction: elapsedMin < 0 → 1.0 (future dose not yet injected)", () => {
  expect(calcBasalFraction(-1,   WINDOW, PEAK_F)).toBe(1);
  expect(calcBasalFraction(-120, WINDOW, PEAK_F)).toBe(1);
});

// ── Parametric: entire plateau stays at 1.0 ──────────────────────────────────

test("calcBasalFraction: every minute inside the plateau returns 1.0", () => {
  // Sample 10 evenly spaced points within [0, PEAK_END]
  const samples = 10;
  for (let i = 0; i <= samples; i++) {
    const t = (PEAK_END * i) / samples;
    expect(calcBasalFraction(t, WINDOW, PEAK_F)).toBe(1);
  }
});

// ── Boundary: different windowMin and peakFraction values ────────────────────

test("calcBasalFraction: works correctly with different peakFraction (0.75)", () => {
  const pf      = 0.75;
  const peakEnd = WINDOW * pf; // 1080 min

  // Inside plateau
  expect(calcBasalFraction(peakEnd, WINDOW, pf)).toBe(1);

  // Halfway into tail
  const halfTail = peakEnd + (WINDOW - peakEnd) / 2;
  const midVal   = calcBasalFraction(halfTail, WINDOW, pf);
  expect(midVal).toBeGreaterThan(0);
  expect(midVal).toBeLessThan(1);
  // Linear tail → midpoint should be close to 0.5
  expect(midVal).toBeCloseTo(0.5, 5);

  // Window end
  expect(calcBasalFraction(WINDOW, WINDOW, pf)).toBe(0);
});

test("calcBasalFraction: works correctly with a shorter window (8 h)", () => {
  const win   = 480; // 8 h in minutes
  const pf    = 0.5;
  const pEnd  = win * pf; // 240 min

  expect(calcBasalFraction(0,    win, pf)).toBe(1);
  expect(calcBasalFraction(pEnd, win, pf)).toBe(1);

  const result = calcBasalFraction(pEnd + 1, win, pf);
  expect(result).toBeGreaterThan(0);
  expect(result).toBeLessThan(1);

  expect(calcBasalFraction(win,      win, pf)).toBe(0);
  expect(calcBasalFraction(win + 60, win, pf)).toBe(0);
});
