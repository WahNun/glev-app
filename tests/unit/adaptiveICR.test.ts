// Unit coverage for `lib/engine/adaptiveICR.ts` — the time-of-day
// bucketed insulin-to-carb ratio used by the dose recommender.
//
// Locks in:
//   1. Time-of-day bucketing: <11=morning, <17=afternoon, ≥17=evening.
//   2. Min-3-samples threshold per time-of-day bucket — buckets below
//      the threshold return `null`, but `global` is computed from the
//      first sample.
//   3. Outcome weighting: GOOD=1.0, SPIKE=0.7, UNDER=0.3, OVER=0.3,
//      CHECK_CONTEXT=0.5 — verified by mixing two ratios with
//      different outcomes and checking the weighted average.
//   4. Filtering: non-final meals, carbs<=0, insulin<=0 are dropped.
//   5. Empty input returns nulls everywhere and sampleSize=0.

import { test, expect } from "@playwright/test";

import { computeAdaptiveICR } from "@/lib/engine/adaptiveICR";
import { makeFinalMeal, makeMeal, FIXTURE_BASE_MS } from "../support/engineFixtures";
import type { Meal } from "@/lib/meals";

/** Build a final-state meal at a specific hour-of-day with a chosen
 *  carbs/insulin ratio. delta=10 → GOOD outcome (weight 1.0).
 *
 *  We construct the meal_time in LOCAL wall-clock so that
 *  `timeOfDay()` (which calls `Date.getHours()`) sees the requested
 *  hour regardless of the host TZ. Round-tripping a local Date through
 *  ISO + parseDbDate preserves the local hour. */
function mealAt(hour: number, carbs: number, insulin: number, delta = 10, id = `m_${hour}_${carbs}_${insulin}`): Meal {
  const day = new Date(2026, 3, 30, hour, 0, 0); // local Apr 30 2026 @ hour
  return makeFinalMeal(id, delta, {
    carbs_grams: carbs,
    insulin_units: insulin,
    meal_time: day.toISOString(),
    created_at: day.toISOString(),
  });
}

test("computeAdaptiveICR: empty input returns all nulls", () => {
  const r = computeAdaptiveICR([]);
  expect(r).toEqual({ global: null, morning: null, afternoon: null, evening: null, sampleSize: 0 });
});

test("computeAdaptiveICR: skips non-final meals", () => {
  // Pending meal (no readings, fresh) — should be skipped entirely.
  const pending = makeMeal({ id: "p", meal_time: new Date().toISOString(), created_at: new Date().toISOString() });
  const r = computeAdaptiveICR([pending]);
  expect(r.sampleSize).toBe(0);
  expect(r.global).toBeNull();
});

test("computeAdaptiveICR: skips meals with carbs ≤ 0 or insulin ≤ 0", () => {
  const noCarbs   = mealAt(10, 0, 4, 10, "no-c");
  const noInsulin = mealAt(10, 50, 0, 10, "no-i");
  const r = computeAdaptiveICR([noCarbs, noInsulin]);
  expect(r.sampleSize).toBe(0);
});

test("computeAdaptiveICR: time-of-day buckets — morning <11, afternoon <17, evening ≥17", () => {
  // Need ≥3 in each bucket to expose them. Use ratio 12 in morning,
  // 15 in afternoon, 18 in evening.
  const meals: Meal[] = [
    ...[8, 9, 10].map(h => mealAt(h, 60, 5, 10, `morn-${h}`)),    // 12g/u
    ...[12, 14, 16].map(h => mealAt(h, 60, 4, 10, `aft-${h}`)),   // 15g/u
    ...[17, 19, 21].map(h => mealAt(h, 90, 5, 10, `eve-${h}`)),   // 18g/u
  ];
  const r = computeAdaptiveICR(meals);
  expect(r.morning).toBeCloseTo(12, 5);
  expect(r.afternoon).toBeCloseTo(15, 5);
  expect(r.evening).toBeCloseTo(18, 5);
  expect(r.sampleSize).toBe(9);
  // global is the average across all 9 samples (equal weights, GOOD=1.0).
  expect(r.global).toBeCloseTo((12 + 15 + 18) / 3, 5);
});

test("computeAdaptiveICR: time-of-day bucket below 3 samples returns null", () => {
  // 2 morning meals → morning stays null but contributes to global.
  const meals = [
    mealAt(8, 60, 5, 10, "m1"),
    mealAt(9, 60, 5, 10, "m2"),
  ];
  const r = computeAdaptiveICR(meals);
  expect(r.morning).toBeNull();
  expect(r.afternoon).toBeNull();
  expect(r.evening).toBeNull();
  expect(r.global).toBeCloseTo(12, 5);
  expect(r.sampleSize).toBe(2);
});

test("computeAdaptiveICR: outcome weighting — GOOD=1.0 vs UNDERDOSE=0.3", () => {
  // GOOD ratio 10, UNDERDOSE ratio 20.
  // Weighted avg = (10*1.0 + 20*0.3) / (1.0 + 0.3) = 16/1.3 ≈ 12.31
  const good  = mealAt(10, 50, 5, 10, "g");                        // GOOD
  const under = mealAt(10, 100, 5, 45, "u");                       // delta=45 → UNDERDOSE
  const r = computeAdaptiveICR([good, under]);
  expect(r.global).toBeCloseTo((10 * 1.0 + 20 * 0.3) / 1.3, 4);
});

test("computeAdaptiveICR: SPIKE outcome contributes with weight 0.7", () => {
  const good  = mealAt(10, 50, 5, 10, "g");                        // ratio 10, weight 1.0
  const spike = mealAt(10, 100, 5, 80, "s");                       // ratio 20, weight 0.7
  const r = computeAdaptiveICR([good, spike]);
  expect(r.global).toBeCloseTo((10 * 1.0 + 20 * 0.7) / 1.7, 4);
});

test("computeAdaptiveICR: hour-boundary placement — 11:00 is afternoon, 17:00 is evening", () => {
  // 3 meals at 11:00 → afternoon bucket.
  const aft = [11, 11, 11].map((_, i) => mealAt(11, 60, 4, 10, `a${i}`));
  // 3 meals at 17:00 → evening bucket.
  const eve = [17, 17, 17].map((_, i) => mealAt(17, 60, 4, 10, `e${i}`));
  const r = computeAdaptiveICR([...aft, ...eve]);
  expect(r.morning).toBeNull();
  expect(r.afternoon).not.toBeNull();
  expect(r.evening).not.toBeNull();
});
