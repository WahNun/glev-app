// Unit tests for shouldShowBothChips (lib/engine/doseChipGating.ts).
//
// The gate controls whether the Engine page renders two ICR chips
// (Adaptiv + Fixwert) or collapses to one. Two conditions must pass:
//
//   1. icrSampleSize >= 3  — not enough historical data otherwise
//   2. Both ICR values > 0 — must be valid positive values
//
// Dose-diff and ICR-diff suppression were intentionally removed:
// the user explicitly wants to see both options and pick one, even
// when the numbers are close. See lib/engine/doseChipGating.ts.

import { test, expect } from "@playwright/test";
import { shouldShowBothChips } from "@/lib/engine/doseChipGating";

// ── helper so tests stay concise ─────────────────────────────────────

function gate(opts: {
  icrSampleSize?: number;
  adaptedICR?: number;
  staticICR?: number;
  adaptiveDose?: number | null;
  staticDose?: number | null;
}): boolean {
  return shouldShowBothChips({
    icrSampleSize: opts.icrSampleSize ?? 10,
    adaptedICR:    opts.adaptedICR    ?? 8,
    staticICR:     opts.staticICR     ?? 15,
    adaptiveDose:  opts.adaptiveDose  ?? null,
    staticDose:    opts.staticDose    ?? null,
  });
}

// ── condition 1: icrSampleSize >= 3 ──────────────────────────────────

test("shouldShowBothChips: false when sampleSize < 3 (0)", () => {
  expect(gate({ icrSampleSize: 0 })).toBe(false);
});

test("shouldShowBothChips: false when sampleSize = 1", () => {
  expect(gate({ icrSampleSize: 1 })).toBe(false);
});

test("shouldShowBothChips: false when sampleSize = 2", () => {
  expect(gate({ icrSampleSize: 2 })).toBe(false);
});

test("shouldShowBothChips: true when sampleSize = 3 (boundary)", () => {
  expect(gate({ icrSampleSize: 3 })).toBe(true);
});

test("shouldShowBothChips: true when sampleSize = 20", () => {
  expect(gate({ icrSampleSize: 20 })).toBe(true);
});

// ── condition 2: both ICR values > 0 ─────────────────────────────────

test("shouldShowBothChips: false when adaptedICR = 0", () => {
  expect(gate({ adaptedICR: 0, staticICR: 10 })).toBe(false);
});

test("shouldShowBothChips: false when staticICR = 0", () => {
  expect(gate({ adaptedICR: 10, staticICR: 0 })).toBe(false);
});

test("shouldShowBothChips: true when both ICR values are positive", () => {
  expect(gate({ adaptedICR: 8, staticICR: 15 })).toBe(true);
});

// ── dose diff and ICR diff no longer gate the chips ──────────────────
// These tests confirm the simplification: identical ICR values or
// identical dose values no longer hide the second chip.

test("shouldShowBothChips: true even when ICR values are identical", () => {
  expect(gate({ adaptedICR: 10, staticICR: 10 })).toBe(true);
});

test("shouldShowBothChips: true even when both doses are identical", () => {
  expect(gate({ adaptiveDose: 2.5, staticDose: 2.5 })).toBe(true);
});

test("shouldShowBothChips: true when both doses are null", () => {
  expect(gate({ adaptiveDose: null, staticDose: null })).toBe(true);
});

test("shouldShowBothChips: true when only adaptiveDose is null", () => {
  expect(gate({ adaptiveDose: null, staticDose: 3.0 })).toBe(true);
});

test("shouldShowBothChips: true when only staticDose is null", () => {
  expect(gate({ adaptiveDose: 3.0, staticDose: null })).toBe(true);
});

// ── all conditions must hold simultaneously ───────────────────────────

test("shouldShowBothChips: false when sampleSize=2 even if ICR values are large", () => {
  expect(gate({ icrSampleSize: 2, adaptiveDose: 1.0, staticDose: 5.0 })).toBe(false);
});

test("shouldShowBothChips: true when sampleSize >= 3 and both ICR > 0", () => {
  expect(gate({ icrSampleSize: 10, adaptedICR: 10, staticICR: 10.3 })).toBe(true);
});

// ── real-world regression ─────────────────────────────────────────────
// Both ICR and dose comparisons now show chips regardless of similarity.

test("regression: 5g carbs, ICR 8 vs 9 → both chips shown", () => {
  const adaptiveDose = Math.round((5 / 8) * 10) / 10; // 0.6
  const staticDose   = Math.round((5 / 9) * 10) / 10; // 0.6
  expect(adaptiveDose).toBe(staticDose); // both round to 0.6
  expect(gate({
    icrSampleSize: 10,
    adaptedICR: 8, staticICR: 9,
    adaptiveDose, staticDose,
  })).toBe(true);
});

test("regression: 30g carbs, ICR 8 vs 15 → chips shown", () => {
  const adaptiveDose = Math.round((30 / 8)  * 10) / 10; // 3.8
  const staticDose   = Math.round((30 / 15) * 10) / 10; // 2.0
  expect(gate({
    icrSampleSize: 10,
    adaptedICR: 8, staticICR: 15,
    adaptiveDose, staticDose,
  })).toBe(true);
});
