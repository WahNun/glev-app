// Unit tests for `detectIOBPeaks` (lib/iob.ts).
//
// The peak algorithm: a sample is a local maximum when
//   (a) it is strictly greater than BOTH immediate neighbours, AND
//   (b) its value exceeds the lower of the two neighbours by ≥ 0.5 IE.
// At most 3 peaks are returned, ranked by descending IOB value.
// Samples at index 0 and the last index are never peaks.

import { test, expect } from "@playwright/test";
import { detectIOBPeaks, buildDoses } from "@/lib/iob";
import type { IOBSample, InsulinLike, MealLike } from "@/lib/iob";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal IOBSample array from an iob-values-only number array. */
function samples(...iobValues: number[]): IOBSample[] {
  return iobValues.map((iob, i) => ({ tMs: i * 15 * 60_000, iob }));
}

// ── edge cases: too-short arrays ─────────────────────────────────────────────

test("zero-activity array (all zeros) returns empty", () => {
  expect(detectIOBPeaks(samples(0, 0, 0, 0, 0))).toEqual([]);
});

test("empty array returns empty", () => {
  expect(detectIOBPeaks([])).toEqual([]);
});

test("single-element array returns empty", () => {
  expect(detectIOBPeaks(samples(2))).toEqual([]);
});

test("two-element array returns empty (no interior index)", () => {
  expect(detectIOBPeaks(samples(2, 1))).toEqual([]);
});

// ── boundary: start / end positions ──────────────────────────────────────────

test("peak at index 0 (first element) is NOT detected", () => {
  // [5, 3, 1] — index 0 has the highest value but is never interior
  expect(detectIOBPeaks(samples(5, 3, 1))).toEqual([]);
});

test("peak at last index is NOT detected", () => {
  // [1, 3, 5] — last index is never interior
  expect(detectIOBPeaks(samples(1, 3, 5))).toEqual([]);
});

// ── threshold: 0.5 IE minimum rise ───────────────────────────────────────────

test("peak exactly 0.5 IE above lower neighbour IS detected", () => {
  // cur=2.0, prev=1.5, next=1.4 → cur − min(prev,next) = 0.6 ≥ 0.5 ✓
  const result = detectIOBPeaks(samples(1.5, 2.0, 1.4));
  expect(result).toHaveLength(1);
  expect(result[0].iob).toBe(2.0);
});

test("peak exactly at threshold boundary (cur − lower neighbour = 0.5) IS detected", () => {
  // cur=2.0, prev=1.5, next=1.5 → diff = 0.5 (≥ 0.5) ✓
  const result = detectIOBPeaks(samples(1.5, 2.0, 1.5));
  expect(result).toHaveLength(1);
  expect(result[0].iob).toBe(2.0);
});

test("peak only 0.49 IE above lower neighbour is NOT detected", () => {
  // cur=1.99, prev=1.5, next=1.5 → diff = 0.49 < 0.5 ✗
  const result = detectIOBPeaks(samples(1.5, 1.99, 1.5));
  expect(result).toHaveLength(0);
});

test("small bump on plateau (< 0.5 IE rise) is NOT detected as peak", () => {
  // Flat plateau with a tiny local high: 2.0, 2.3, 2.0 → diff = 0.3 < 0.5
  const result = detectIOBPeaks(samples(2.0, 2.3, 2.0, 2.1, 2.0));
  expect(result).toHaveLength(0);
});

// ── single peak ───────────────────────────────────────────────────────────────

test("single clear peak is detected with correct iob and tMs", () => {
  // [0.5, 3.0, 0.5] — one obvious peak at index 1
  const input = samples(0.5, 3.0, 0.5);
  const result = detectIOBPeaks(input);
  expect(result).toHaveLength(1);
  expect(result[0].iob).toBe(3.0);
  expect(result[0].tMs).toBe(input[1].tMs);
});

// ── multiple peaks ────────────────────────────────────────────────────────────

test("two peaks are both detected", () => {
  // [0, 2, 0, 3, 0] — peaks at indices 1 and 3
  const result = detectIOBPeaks(samples(0, 2, 0, 3, 0));
  expect(result).toHaveLength(2);
  // Sorted highest first
  expect(result[0].iob).toBe(3);
  expect(result[1].iob).toBe(2);
});

test("top-3 cap: only highest 3 peaks are kept when more than 3 exist", () => {
  // 5 local maxima: 1, 2, 3, 4, 5 — only top 3 (5, 4, 3) should be returned
  const result = detectIOBPeaks(
    samples(0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0)
  );
  expect(result).toHaveLength(3);
  expect(result.map(p => p.iob)).toEqual([5, 4, 3]);
});

test("exactly 3 peaks returns all 3", () => {
  const result = detectIOBPeaks(samples(0, 1.5, 0, 2.5, 0, 3.5, 0));
  expect(result).toHaveLength(3);
});

test("peaks are sorted by descending iob value", () => {
  // Peaks at indices 1 (iob=4), 3 (iob=2), 5 (iob=6) → expected order: 6,4,2
  const result = detectIOBPeaks(samples(0, 4, 0, 2, 0, 6, 0));
  expect(result.map(p => p.iob)).toEqual([6, 4, 2]);
});

// ── single-dose day ───────────────────────────────────────────────────────────

test("single-dose day: rising-then-falling profile produces exactly one peak", () => {
  // Parabola-like shape for a single rapid bolus
  const iobValues = [0, 0.5, 2.0, 3.5, 2.8, 1.5, 0.4, 0];
  const result = detectIOBPeaks(samples(...iobValues));
  expect(result).toHaveLength(1);
  expect(result[0].iob).toBe(3.5);
});

// ── flat plateau edge case ────────────────────────────────────────────────────

test("perfectly flat array returns no peaks", () => {
  expect(detectIOBPeaks(samples(2, 2, 2, 2, 2))).toEqual([]);
});

test("rising plateau followed by descent: the plateau edge is NOT a peak", () => {
  // [0, 3, 3, 3, 0] — index 1 is NOT > index 0 by strict inequality… wait:
  // Actually index 1: cur=3>prev=0 ✓ but cur NOT > next=3 (equal) → not a peak.
  // Index 2: cur=3 NOT > prev=3 → not a peak.
  // Index 3: cur=3 > next=0 ✓ but cur NOT > prev=3 → not a peak.
  expect(detectIOBPeaks(samples(0, 3, 3, 3, 0))).toEqual([]);
});

// ── two-element minimal case ──────────────────────────────────────────────────

test("three-element array with valid peak returns that peak", () => {
  const result = detectIOBPeaks(samples(1, 3, 1));
  expect(result).toHaveLength(1);
  expect(result[0].iob).toBe(3);
});

// ── buildDoses: mealId field ──────────────────────────────────────────────────
//
// The IOB peak popover uses `BolusDose.mealId` to decide whether a dose row
// is tappable (navigates to /entries#<mealId>) or inert (manual bolus log).
// These tests lock in the contract so a silent refactor can never strip mealId
// from meal-sourced doses or accidentally attach it to insulin-log doses.

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

test("buildDoses: meal-sourced dose carries mealId equal to meal.id", () => {
  const meals: MealLike[] = [
    { id: "meal-abc", insulin_units: 5, created_at: isoMinutesAgo(30) },
  ];
  const doses = buildDoses([], meals);
  expect(doses).toHaveLength(1);
  expect(doses[0].source).toBe("meal");
  expect(doses[0].mealId).toBe("meal-abc");
});

test("buildDoses: insulin-log dose has no mealId (undefined)", () => {
  const insulin: InsulinLike[] = [
    {
      insulin_type: "bolus",
      units: 4,
      created_at: isoMinutesAgo(30),
      related_entry_id: null,
    },
  ];
  const doses = buildDoses(insulin, []);
  expect(doses).toHaveLength(1);
  expect(doses[0].source).toBe("insulin");
  expect(doses[0].mealId).toBeUndefined();
});

test("buildDoses: when meal and insulin log coexist, only the meal dose has mealId", () => {
  const insulin: InsulinLike[] = [
    {
      insulin_type: "bolus",
      units: 4,
      created_at: isoMinutesAgo(60),
      related_entry_id: null,
      insulin_name: "Novorapid",
    },
  ];
  const meals: MealLike[] = [
    { id: "meal-xyz", insulin_units: 3, created_at: isoMinutesAgo(30) },
  ];
  const doses = buildDoses(insulin, meals);
  expect(doses).toHaveLength(2);
  const mealDose   = doses.find(d => d.source === "meal");
  const bolusDose  = doses.find(d => d.source === "insulin");
  expect(mealDose?.mealId).toBe("meal-xyz");
  expect(bolusDose?.mealId).toBeUndefined();
});

test("buildDoses: linked meal is excluded entirely — no mealId leaks via meal path", () => {
  // When an insulin_log carries related_entry_id pointing to a meal, the meal's
  // insulin_units must NOT produce a second dose row (double-count guard).
  // Consequently, no dose row with mealId for that meal can appear in the list.
  const insulin: InsulinLike[] = [
    {
      insulin_type: "bolus",
      units: 4,
      created_at: isoMinutesAgo(30),
      related_entry_id: "meal-linked",
    },
  ];
  const meals: MealLike[] = [
    { id: "meal-linked", insulin_units: 4, created_at: isoMinutesAgo(30) },
  ];
  const doses = buildDoses(insulin, meals);
  // Only the bolus log — no meal dose row
  expect(doses.every(d => d.mealId === undefined)).toBe(true);
});

test("buildDoses: mealId is set independently for each unlinked meal", () => {
  const meals: MealLike[] = [
    { id: "meal-1", insulin_units: 3, created_at: isoMinutesAgo(20) },
    { id: "meal-2", insulin_units: 5, created_at: isoMinutesAgo(80) },
  ];
  const doses = buildDoses([], meals);
  const ids = doses.map(d => d.mealId);
  expect(ids).toContain("meal-1");
  expect(ids).toContain("meal-2");
});
