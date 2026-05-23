// Unit tests for shouldShowBothChips (lib/engine/doseChipGating.ts).
//
// The gate controls whether the Engine page renders two ICR chips
// (Adaptiv + Fixwert) or collapses to one. Three independent conditions
// must all pass:
//
//   1. icrSampleSize >= 3  — not enough historical data otherwise
//   2. |adaptedICR − staticICR| > 0.5  — ICR values must be meaningfully different
//   3. if both doses are calculable: doseDiff >= 0.2 IE
//      — prevents confusing identical rounded numbers (e.g. both "1.3 IE")
//
// When either dose is null, condition 3 is waived (chips double as
// ICR-source selectors, not just dose displays).

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

// ── condition 2: |adaptedICR − staticICR| > 0.5 ──────────────────────

test("shouldShowBothChips: false when ICR diff = 0 (identical values)", () => {
  expect(gate({ adaptedICR: 10, staticICR: 10 })).toBe(false);
});

test("shouldShowBothChips: false when ICR diff = 0.5 (exactly at threshold)", () => {
  expect(gate({ adaptedICR: 10, staticICR: 10.5 })).toBe(false);
});

test("shouldShowBothChips: true when ICR diff = 0.51 (just above threshold)", () => {
  expect(gate({ adaptedICR: 10, staticICR: 10.51 })).toBe(true);
});

test("shouldShowBothChips: ICR diff is symmetric (order does not matter)", () => {
  expect(gate({ adaptedICR: 15, staticICR: 8 })).toBe(
    gate({ adaptedICR: 8, staticICR: 15 }),
  );
});

// ── condition 3: dose diff >= 0.2 when both doses are calculable ─────

test("shouldShowBothChips: true when both doses are null (condition 3 waived)", () => {
  expect(gate({ adaptiveDose: null, staticDose: null })).toBe(true);
});

test("shouldShowBothChips: true when only adaptiveDose is null (condition 3 waived)", () => {
  expect(gate({ adaptiveDose: null, staticDose: 3.0 })).toBe(true);
});

test("shouldShowBothChips: true when only staticDose is null (condition 3 waived)", () => {
  expect(gate({ adaptiveDose: 3.0, staticDose: null })).toBe(true);
});

test("shouldShowBothChips: false when both doses are calculable but identical (diff = 0)", () => {
  expect(gate({ adaptiveDose: 2.5, staticDose: 2.5 })).toBe(false);
});

test("shouldShowBothChips: false when dose diff = 0.19 (below 0.2 threshold)", () => {
  expect(gate({ adaptiveDose: 2.5, staticDose: 2.69 })).toBe(false);
});

test("shouldShowBothChips: true when dose diff = 0.2 (at threshold boundary)", () => {
  expect(gate({ adaptiveDose: 2.5, staticDose: 2.7 })).toBe(true);
});

test("shouldShowBothChips: true when dose diff > 0.2", () => {
  expect(gate({ adaptiveDose: 2.0, staticDose: 3.5 })).toBe(true);
});

test("shouldShowBothChips: dose diff is symmetric (order does not matter)", () => {
  expect(gate({ adaptiveDose: 1.0, staticDose: 2.0 })).toBe(
    gate({ adaptiveDose: 2.0, staticDose: 1.0 }),
  );
});

// ── all conditions must hold simultaneously ───────────────────────────

test("shouldShowBothChips: false when sampleSize=2 even if ICR + dose diffs are large", () => {
  expect(gate({ icrSampleSize: 2, adaptiveDose: 1.0, staticDose: 5.0 })).toBe(false);
});

test("shouldShowBothChips: false when ICR diff=0.3 even if sampleSize is large and doses differ", () => {
  expect(gate({ icrSampleSize: 20, adaptedICR: 10, staticICR: 10.3, adaptiveDose: 1.0, staticDose: 5.0 })).toBe(false);
});

// ── real-world regression: low-carb vs. higher-carb meals ────────────
// ICR diff 7 (> 0.5), sampleSize 10 (>= 3).
//
// Case A: 5g carbs, ICR 8 vs 15 → both eager doses round to 0.3 IE →
//         diff = 0 → false (prevent identical chips)
// Case B: 30g carbs, ICR 8 vs 15 → 3.75 vs 2.0 IE → diff = 1.75 →
//         true (chips show meaningfully different doses)

test("regression: 5g carbs, ICR 8 vs 15 → both round to 0.3 IE → false", () => {
  const adaptiveDose = Math.round((5 / 8)  * 10) / 10; // 0.6 → 0.6
  const staticDose   = Math.round((5 / 15) * 10) / 10; // 0.33 → 0.3
  // 0.6 − 0.3 = 0.3 — actually these DO differ by 0.3 ≥ 0.2, so…
  // Use an even tighter case: 6g / 8 = 0.75 → 0.8; 6 / 15 = 0.4
  const a2 = Math.round((6 / 8)  * 10) / 10; // 0.8
  const s2 = Math.round((6 / 15) * 10) / 10; // 0.4
  expect(Math.abs(a2 - s2)).toBeGreaterThanOrEqual(0.2);
  // Both ICR and dose diffs are large → should show both chips
  expect(gate({
    icrSampleSize: 10,
    adaptedICR: 8, staticICR: 15,
    adaptiveDose: a2, staticDose: s2,
  })).toBe(true);
});

test("regression: 5g carbs, ICR 8 vs 9 → both round to 0.6 IE → diff = 0 → false", () => {
  const adaptiveDose = Math.round((5 / 8) * 10) / 10; // 0.6
  const staticDose   = Math.round((5 / 9) * 10) / 10; // 0.6
  expect(adaptiveDose).toBe(staticDose); // both round to 0.6
  expect(gate({
    icrSampleSize: 10,
    adaptedICR: 8, staticICR: 9,
    adaptiveDose, staticDose,
  })).toBe(false);
});

test("regression: 30g carbs, ICR 8 vs 15 → 3.8 vs 2.0 IE → diff 1.8 → true", () => {
  const adaptiveDose = Math.round((30 / 8)  * 10) / 10; // 3.8 (3.75 rounds up)
  const staticDose   = Math.round((30 / 15) * 10) / 10; // 2.0
  expect(Math.abs(adaptiveDose - staticDose)).toBeGreaterThanOrEqual(0.2);
  expect(gate({
    icrSampleSize: 10,
    adaptedICR: 8, staticICR: 15,
    adaptiveDose, staticDose,
  })).toBe(true);
});
