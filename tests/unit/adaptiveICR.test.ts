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
import { makeFinalMeal, makeMeal, makeInsulinLog, FIXTURE_BASE_MS } from "../support/engineFixtures";
import type { Meal } from "@/lib/meals";
import type { InsulinLog } from "@/lib/insulin";

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
  expect(r).toEqual({ global: null, morning: null, afternoon: null, evening: null, sampleSize: 0, pairedCount: 0 });
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

// ── Bolus↔Mahlzeiten-Pairing (Task #188) ────────────────────────────
//
// When the optional `boluses` arg is provided, computeAdaptiveICR pairs
// the bolus logs to meals (via lib/engine/pairing.ts) and uses the SUM
// of paired bolus units as the meal's insulin value, falling back to
// `meal.insulin_units` when no pair exists. Meals without a pair only
// contribute when their own `insulin_units` is > 0.

/** Build a paired bolus log at the given offset (minutes from FIXTURE_BASE_MS),
 *  optionally explicitly tagged to a meal id. */
function bolusAt(offsetMin: number, units: number, opts: { id?: string; relatedTo?: string | null } = {}): InsulinLog {
  return makeInsulinLog({
    id: opts.id ?? `b_${offsetMin}_${units}`,
    units,
    related_entry_id: opts.relatedTo ?? null,
    created_at: new Date(FIXTURE_BASE_MS + offsetMin * 60_000).toISOString(),
  });
}

test("computeAdaptiveICR: explicit related_entry_id pair — bolus units replace meal.insulin_units", () => {
  // Meal records 4u in insulin_units, but the user actually injected
  // 8u via a separately-logged bolus tagged to this meal. With pairing,
  // the engine should see 50g/8u = 6.25 g/u, NOT 50/4 = 12.5.
  const m = mealAt(10, 50, 4, 10, "meal-A");
  const b = bolusAt(0, 8, { id: "b1", relatedTo: "meal-A" });
  const r = computeAdaptiveICR([m], [b]);
  expect(r.sampleSize).toBe(1);
  expect(r.global).toBeCloseTo(50 / 8, 5);
});

test("computeAdaptiveICR: time-window pair — bolus within ±30 min picked when no explicit tag", () => {
  // Meal carbs=60, meal.insulin_units=3 (would be 20 g/u without pairing).
  // Bolus 5u logged 10 min after the meal time (within ±30 min window)
  // → engine should use the 5u value: 60/5 = 12 g/u.
  const meal = makeFinalMeal("meal-tw", 10, {
    carbs_grams: 60,
    insulin_units: 3,
    meal_time: new Date(FIXTURE_BASE_MS).toISOString(),
    created_at: new Date(FIXTURE_BASE_MS).toISOString(),
  });
  const b = bolusAt(10, 5, { id: "b-tw" });
  const r = computeAdaptiveICR([meal], [b]);
  expect(r.sampleSize).toBe(1);
  expect(r.global).toBeCloseTo(12, 5);
});

test("computeAdaptiveICR: multi-bolus per meal — explicitly-tagged paired bolus units are summed", () => {
  // User split a single meal across two explicitly-tagged shots
  // (pre-bolus + correction). pairBolusesToMeals is 1:1, so we group
  // explicit related_entry_id matches up-front in adaptiveICR itself
  // and sum their units. Expectation: 3u + 2u = 5u, so 60g/5u = 12 g/u
  // (NOT 60/3 = 20 — that would silently drop the correction shot).
  const meal = makeFinalMeal("meal-split", 10, {
    carbs_grams: 60,
    insulin_units: 999, // sentinel — must be ignored when boluses are paired
    meal_time: new Date(FIXTURE_BASE_MS).toISOString(),
    created_at: new Date(FIXTURE_BASE_MS).toISOString(),
  });
  const b1 = bolusAt(0,  3, { id: "b-pre",  relatedTo: "meal-split" });
  const b2 = bolusAt(15, 2, { id: "b-corr", relatedTo: "meal-split" });
  const r = computeAdaptiveICR([meal], [b1, b2]);
  expect(r.sampleSize).toBe(1);
  expect(r.global).toBeCloseTo(60 / 5, 5);
});

test("computeAdaptiveICR: multi-bolus per meal — explicit + extra time-window bolus does NOT double-count", () => {
  // One explicit-tagged bolus (3u) + one untagged bolus near the same
  // meal. Once the explicit pass has covered the meal it's locked in;
  // the untagged bolus must not also be folded in via the time-window
  // helper. Expectation: 60g/3u = 20 g/u.
  const meal = makeFinalMeal("meal-explicit", 10, {
    carbs_grams: 60,
    insulin_units: 0,
    meal_time: new Date(FIXTURE_BASE_MS).toISOString(),
    created_at: new Date(FIXTURE_BASE_MS).toISOString(),
  });
  const tagged   = bolusAt(0,  3, { id: "b-tag",   relatedTo: "meal-explicit" });
  const untagged = bolusAt(10, 7, { id: "b-untag" });
  const r = computeAdaptiveICR([meal], [tagged, untagged]);
  expect(r.sampleSize).toBe(1);
  expect(r.global).toBeCloseTo(60 / 3, 5);
});

test("computeAdaptiveICR: meal without bolus pair falls back to meal.insulin_units", () => {
  // Two meals: one paired (uses bolus sum), one un-paired (uses
  // meal.insulin_units). Both should contribute to sampleSize/global.
  const paired   = mealAt(10, 50, 4, 10, "p");           // ignored 4u, paired 5u → 10
  const unpaired = mealAt(10, 60, 5, 10, "u");           // 60/5 = 12
  const b = bolusAt(0, 5, { id: "b-paired", relatedTo: "p" });
  const r = computeAdaptiveICR([paired, unpaired], [b]);
  expect(r.sampleSize).toBe(2);
  // Both samples have GOOD outcome (weight 1.0) → simple average.
  expect(r.global).toBeCloseTo((10 + 12) / 2, 5);
});

test("computeAdaptiveICR: meal with no pair AND no insulin_units is skipped", () => {
  // A meal without any bolus pair AND insulin_units=0 must NOT
  // inflate sampleSize. Only the paired meal counts.
  const skipped = mealAt(10, 80, 0, 10, "skip");         // insulin_units=0 → skip
  const paired  = mealAt(10, 50, 0, 10, "kept");         // insulin_units=0 but paired → keep
  const b = bolusAt(0, 5, { id: "b-kept", relatedTo: "kept" });
  const r = computeAdaptiveICR([skipped, paired], [b]);
  expect(r.sampleSize).toBe(1);
  expect(r.global).toBeCloseTo(10, 5);
});

test("computeAdaptiveICR: empty boluses array preserves legacy meal.insulin_units behaviour", () => {
  // Passing `[]` for boluses must behave identically to omitting the
  // arg — no meal becomes paired, every contribution comes from
  // meal.insulin_units.
  const m1 = mealAt(10, 50, 5, 10, "m1");
  const m2 = mealAt(10, 60, 4, 10, "m2");
  const a = computeAdaptiveICR([m1, m2]);
  const b = computeAdaptiveICR([m1, m2], []);
  expect(b).toEqual(a);
});

test("computeAdaptiveICR: pairedCount reflects how many meals used a bolus pair vs meal.insulin_units", () => {
  // Three meals: one explicit-tag pair, one time-window pair,
  // one fallback to meal.insulin_units. pairedCount must be 2.
  const m1 = mealAt(10, 50, 4, 10, "m1");                              // explicit-tag → paired
  const m2 = makeFinalMeal("m2", 10, {
    carbs_grams: 60, insulin_units: 3,
    meal_time: new Date(FIXTURE_BASE_MS).toISOString(),
    created_at: new Date(FIXTURE_BASE_MS).toISOString(),
  });                                                                  // time-window → paired
  const m3 = mealAt(10, 50, 5, 10, "m3");                              // no bolus → fallback
  const b1 = bolusAt(0,  6, { id: "b1", relatedTo: "m1" });
  const b2 = bolusAt(10, 5, { id: "b2" });
  const r = computeAdaptiveICR([m1, m2, m3], [b1, b2]);
  expect(r.sampleSize).toBe(3);
  expect(r.pairedCount).toBe(2);
});

test("computeAdaptiveICR: pairedCount is 0 when no boluses are provided", () => {
  const m1 = mealAt(10, 50, 5, 10, "m1");
  const m2 = mealAt(10, 60, 4, 10, "m2");
  const r = computeAdaptiveICR([m1, m2]);
  expect(r.sampleSize).toBe(2);
  expect(r.pairedCount).toBe(0);
});

test("computeAdaptiveICR: basal logs in the bolus list are ignored by pairing", () => {
  // pairBolusesToMeals filters basal entries out, so a basal log
  // sitting next to a meal must NOT be summed into the meal's insulin.
  // The meal falls back to its own insulin_units = 4 → 50/4 = 12.5.
  const m = mealAt(10, 50, 4, 10, "m-basal");
  const basal = makeInsulinLog({
    id: "ba1",
    insulin_type: "basal",
    units: 20,
    related_entry_id: "m-basal", // even an explicit tag must be ignored
    created_at: new Date(FIXTURE_BASE_MS).toISOString(),
  });
  const r = computeAdaptiveICR([m], [basal]);
  expect(r.sampleSize).toBe(1);
  expect(r.global).toBeCloseTo(12.5, 5);
});
