// Unit coverage for `computeControlScore` in `lib/controlScore.ts` —
// the rolling 7-day Control Score that powers the dashboard hero card.
//
// Why this exists:
//   Task #15's spec pinned the formula to
//
//       clamp(goodRate*0.7 + (100 - spikeRate - hypoRate)*0.3, 0, 100)
//
//   but the only callers are React render trees, so a future refactor
//   could silently swap a coefficient (0.7 vs 0.3) or change which
//   outcomes count toward `spike` / `hypo` and the dashboard would
//   keep rendering plausible-looking numbers. Task #41 pins the
//   formula on a hand-built meal set.
//
// To make the lifecycle decisions deterministic without relying on
// wall-clock time, every fixture meal carries `bg_2h` and `bg_2h_at`
// inside the ±30 min validation window. That forces `lifecycleFor` to
// return `state: "final"` and the unified outcome falls straight out
// of the bgBefore/bg_2h delta.

import { test, expect } from "@playwright/test";

import { computeControlScore } from "@/lib/controlScore";
import type { Meal } from "@/lib/meals";

/* ──────────────────────────────────────────────────────────────────
   Fixture builders.
   ────────────────────────────────────────────────────────────────── */

const BASE_MS = Date.parse("2026-04-30T08:00:00Z");
/** A `now` that's well past the 2h window for every fixture meal — the
 *  bg_2h branch in lifecycleFor doesn't depend on `ageMinutes`, but
 *  passing an explicit `now` keeps the test independent of the host
 *  clock entirely. */
const NOW = new Date(BASE_MS + 7 * 24 * 3600_000);

function makeMeal(overrides: Partial<Meal>): Meal {
  return {
    id: "m1",
    user_id: "u1",
    input_text: "",
    parsed_json: [],
    glucose_before: 100,
    glucose_after: null,
    bg_1h: null,
    bg_1h_at: null,
    bg_2h: null,
    bg_2h_at: null,
    glucose_30min: null,
    glucose_30min_at: null,
    glucose_1h: null,
    glucose_1h_at: null,
    glucose_90min: null,
    glucose_90min_at: null,
    glucose_2h: null,
    glucose_2h_at: null,
    glucose_3h: null,
    glucose_3h_at: null,
    outcome_state: null,
    min_bg_180: null, max_bg_180: null, time_to_peak_min: null,
    auc_180: null, had_hypo_window: null, min_bg_60_180: null,
    meal_time: new Date(BASE_MS).toISOString(),
    carbs_grams: 50,
    protein_grams: 10,
    fat_grams: 5,
    fiber_grams: 3,
    calories: null,
    insulin_units: 4,
    meal_type: "BALANCED",
    evaluation: null,
    related_meal_id: null,
    created_at: new Date(BASE_MS).toISOString(),
    ...overrides,
  };
}

/** Builds a meal whose `bg_2h` lands exactly at meal_time + 120min so
 *  `lifecycleFor` returns `state: "final"` deterministically. `delta`
 *  drives the unified outcome (GOOD / SPIKE / OVERDOSE). */
function mealWithDelta(id: string, delta: number, offsetDays = 0): Meal {
  const mealMs = BASE_MS + offsetDays * 24 * 3600_000;
  const mealIso = new Date(mealMs).toISOString();
  const bg2hAt = new Date(mealMs + 120 * 60_000).toISOString();
  return makeMeal({
    id,
    glucose_before: 100,
    bg_2h: 100 + delta,
    bg_2h_at: bg2hAt,
    meal_time: mealIso,
    created_at: mealIso,
  });
}

/** Builds a meal whose bg_2h is OUTSIDE the ±30 min window so
 *  `unifiedOutcome` returns `null` → falls into the OTHER bucket
 *  (denominator only, neither spike nor hypo). */
function otherMeal(id: string, offsetDays = 0): Meal {
  const mealMs = BASE_MS + offsetDays * 24 * 3600_000;
  const mealIso = new Date(mealMs).toISOString();
  const bg2hAt = new Date(mealMs + (120 + 60) * 60_000).toISOString(); // +60 min late
  return makeMeal({
    id,
    glucose_before: 100,
    bg_2h: 200,
    bg_2h_at: bg2hAt,
    meal_time: mealIso,
    created_at: mealIso,
  });
}

/* ──────────────────────────────────────────────────────────────────
   Spec formula on a hand-built meal set.
   ────────────────────────────────────────────────────────────────── */

test("computeControlScore: 7 GOOD + 2 SPIKE + 1 OVERDOSE → score 70", () => {
  const meals: Meal[] = [
    ...Array.from({ length: 7 }, (_, i) => mealWithDelta(`g${i}`, 10)),       // GOOD
    mealWithDelta("s0", 80), mealWithDelta("s1", 80),                          // SPIKE×2
    mealWithDelta("o0", -50),                                                  // OVERDOSE
  ];
  // goodRate=70, spikeRate=20, hypoRate=10.
  // raw = 70*0.7 + (100-20-10)*0.3 = 49 + 21 = 70 → 70.
  const r = computeControlScore(meals, BASE_MS - 1, BASE_MS + 7 * 24 * 3600_000, NOW);
  expect(r.count).toBe(10);
  expect(r.score).toBe(70);
});

test("computeControlScore: all-GOOD set → score 100 (formula upper bound)", () => {
  const meals = Array.from({ length: 5 }, (_, i) => mealWithDelta(`g${i}`, 10));
  const r = computeControlScore(meals, BASE_MS - 1, BASE_MS + 7 * 24 * 3600_000, NOW);
  expect(r.count).toBe(5);
  // raw = 100*0.7 + 100*0.3 = 100.
  expect(r.score).toBe(100);
});

test("computeControlScore: all-SPIKE set → score 0 (formula lower bound)", () => {
  const meals = Array.from({ length: 5 }, (_, i) => mealWithDelta(`s${i}`, 80));
  const r = computeControlScore(meals, BASE_MS - 1, BASE_MS + 7 * 24 * 3600_000, NOW);
  expect(r.count).toBe(5);
  // raw = 0*0.7 + (100-100-0)*0.3 = 0 → clamp 0.
  expect(r.score).toBe(0);
});

test("computeControlScore: all-OVERDOSE set → score 0", () => {
  const meals = Array.from({ length: 5 }, (_, i) => mealWithDelta(`o${i}`, -50));
  const r = computeControlScore(meals, BASE_MS - 1, BASE_MS + 7 * 24 * 3600_000, NOW);
  expect(r.count).toBe(5);
  // raw = 0 + (100-0-100)*0.3 = 0 → clamp 0.
  expect(r.score).toBe(0);
});

test("computeControlScore: OTHER (out-of-window) rows stay in denominator → drag the score down", () => {
  const meals: Meal[] = [
    ...Array.from({ length: 2 }, (_, i) => mealWithDelta(`g${i}`, 10)),       // 2 GOOD
    ...Array.from({ length: 2 }, (_, i) => mealWithDelta(`s${i}`, 80)),       // 2 SPIKE
    mealWithDelta("o0", -50),                                                  // 1 OVERDOSE
    ...Array.from({ length: 5 }, (_, i) => otherMeal(`x${i}`)),                // 5 OTHER
  ];
  // total=10, good=2, spike=2, hypo=1.
  // goodRate=20, spikeRate=20, hypoRate=10.
  // raw = 20*0.7 + (100-20-10)*0.3 = 14 + 21 = 35 → 35.
  const r = computeControlScore(meals, BASE_MS - 1, BASE_MS + 7 * 24 * 3600_000, NOW);
  expect(r.count).toBe(10);
  expect(r.score).toBe(35);
});

/* ──────────────────────────────────────────────────────────────────
   Window filter + degenerate-input behaviour.
   ────────────────────────────────────────────────────────────────── */

test("computeControlScore: empty meal list → { score: 0, count: 0 }", () => {
  expect(computeControlScore([], BASE_MS - 1, BASE_MS + 7 * 24 * 3600_000, NOW))
    .toEqual({ score: 0, count: 0 });
});

test("computeControlScore: meals outside [sinceMs, untilMs) are filtered out", () => {
  const inWindow = mealWithDelta("g0", 10, 0);                                 // BASE_MS
  const beforeWindow = mealWithDelta("g1", 10, -10);                           // 10d before
  const afterWindow  = mealWithDelta("s0", 80, 7);                             // 7d after
  // Window covers only `BASE_MS` itself.
  const sinceMs = BASE_MS - 1;
  const untilMs = BASE_MS + 1;
  const r = computeControlScore([inWindow, beforeWindow, afterWindow], sinceMs, untilMs, NOW);
  expect(r.count).toBe(1);
  // Single GOOD → 100.
  expect(r.score).toBe(100);
});

test("computeControlScore: untilMs is exclusive — exact boundary meal is excluded", () => {
  // Meal exactly at BASE_MS, untilMs == BASE_MS → the < check excludes it.
  const meals = [mealWithDelta("g0", 10, 0)];
  const r = computeControlScore(meals, BASE_MS - 1, BASE_MS, NOW);
  expect(r.count).toBe(0);
  expect(r.score).toBe(0);
});
