// Unit tests for the bolus-pairing path in `computeAdaptiveICR`.
//
// These tests drive `computeAdaptiveICR` directly with a `boluses`
// array — reproducing the behaviour that the callers (engine/page.tsx,
// insights/page.tsx) use. The function always handles the boluses array.
//
// Covered scenarios:
//   a. Meal with only `insulin_units`, no boluses arg → legacy path.
//   b. Meal with `insulin_units` + bolus log +20 min → bolus takes over
//      (time-window pair wins; meal.insulin_units ignored).
//   c. Meal with bolus 25 min BEFORE, insulin_units=0 → bolus paired.
//   d. Bolus 35 min before meal → outside ±30 min window, not paired,
//      meal excluded (insulin_units=0 + no pair → skipped).
//   e. Mix of paired and unpaired meals → correct weighted average.
//   Integration: realistic 10-meal / 8-bolus scenario with known ICR.

import { test, expect } from "@playwright/test";

import { computeAdaptiveICR } from "@/lib/engine/adaptiveICR";
import {
  makeFinalMeal,
  makeInsulinLog,
  FIXTURE_BASE_MS,
} from "../support/engineFixtures";
import type { Meal } from "@/lib/meals";
import type { InsulinLog } from "@/lib/insulin";

// ── Helpers ──────────────────────────────────────────────────────────

/** Final meal anchored at FIXTURE_BASE_MS + optional offsetMs. */
function meal(
  id: string,
  carbs: number,
  insulinUnits: number,
  offsetMs = 0,
  delta = 10,
): Meal {
  const ts = new Date(FIXTURE_BASE_MS + offsetMs).toISOString();
  return makeFinalMeal(id, delta, {
    carbs_grams: carbs,
    insulin_units: insulinUnits,
    meal_time: ts,
    created_at: ts,
  });
}

/** Bolus at FIXTURE_BASE_MS + offsetMs, optionally tagged to a meal. */
function bolus(
  id: string,
  units: number,
  offsetMs = 0,
  relatedTo: string | null = null,
): InsulinLog {
  return makeInsulinLog({
    id,
    units,
    related_entry_id: relatedTo,
    created_at: new Date(FIXTURE_BASE_MS + offsetMs).toISOString(),
  });
}

const MIN = 60_000; // 1 minute in ms

// ── Scenario a: only insulin_units, no boluses arg ───────────────────

test("pairing a: meal with only insulin_units, no boluses arg → uses meal.insulin_units", () => {
  // Without passing a boluses array the function falls back to the
  // legacy meal.insulin_units field. 60g / 4u = 15 g/u.
  const m = meal("a1", 60, 4);
  const r = computeAdaptiveICR([m]);
  expect(r.sampleSize).toBe(1);
  expect(r.global).toBeCloseTo(15, 5);
  expect(r.pairedCount).toBe(0);
});

// ── Scenario b: insulin_units + bolus +20 min → bolus wins ──────────

test("pairing b: time-window bolus at +20 min overrides meal.insulin_units", () => {
  // Meal has 3u in insulin_units but the user actually injected 5u as a
  // separate bolus log 20 min after the meal. With boluses passed,
  // the engine should see 60g / 5u = 12 g/u, NOT 60 / 3 = 20.
  const m   = meal("b1", 60, 3);                       // insulin_units=3 (sentinel)
  const b   = bolus("b-b1", 5, +20 * MIN);             // +20 min → within ±30 min
  const r   = computeAdaptiveICR([m], [b]);
  expect(r.sampleSize).toBe(1);
  expect(r.global).toBeCloseTo(12, 5);                 // 60/5
  expect(r.pairedCount).toBe(1);
  expect(r.pairedTimeWindowCount).toBe(1);
  expect(r.pairedExplicitCount).toBe(0);
});

// ── Scenario c: bolus 25 min BEFORE, insulin_units=0 → bolus paired ─

test("pairing c: bolus 25 min before meal is within window and pairs correctly", () => {
  // Pre-bolus: user injected 6u 25 min before eating. meal.insulin_units=0.
  // 80g / 6u = 13.33… g/u.
  const m = meal("c1", 80, 0);
  const b = bolus("b-c1", 6, -25 * MIN);               // 25 min before → within ±30 min
  const r = computeAdaptiveICR([m], [b]);
  expect(r.sampleSize).toBe(1);
  expect(r.global).toBeCloseTo(80 / 6, 5);
  expect(r.pairedCount).toBe(1);
  expect(r.pairedTimeWindowCount).toBe(1);
});

// ── Scenario d: bolus 35 min before → outside window, meal excluded ─

test("pairing d: bolus 35 min before meal is outside ±30 min window → meal excluded from sample", () => {
  // The bolus is 35 min earlier — beyond the ±30 min heuristic boundary.
  // meal.insulin_units=0, no pair → meal must NOT contribute to the
  // sample count or the global ICR.
  const m = meal("d1", 70, 0);
  const b = bolus("b-d1", 5, -35 * MIN);               // 35 min before → outside window
  const r = computeAdaptiveICR([m], [b]);
  expect(r.sampleSize).toBe(0);
  expect(r.global).toBeNull();
  expect(r.pairedCount).toBe(0);
});

// ── Scenario e: mix of paired and unpaired meals ──────────────────────

test("pairing e: mix of paired and insulin_units-only meals → correct weighted average", () => {
  // Meal 1: explicitly-tagged bolus 7u → 70g/7u = 10 g/u, GOOD (weight 1.0)
  // Meal 2: time-window bolus +10min 4u → 60g/4u = 15 g/u, GOOD (weight 1.0)
  // Meal 3: no bolus, insulin_units=5u → 75g/5u = 15 g/u, GOOD (weight 1.0)
  // Meal 4: no bolus, insulin_units=0 → excluded
  //
  // Weighted avg of [10, 15, 15] with equal weights = 40/3 ≈ 13.33…
  const m1 = meal("e1", 70, 999, 0);                    // insulin_units sentinel, overridden by bolus
  const m2 = meal("e2", 60, 999, 60 * MIN);             // offset 1h so bolus b2 pairs to it
  const m3 = meal("e3", 75, 5,  120 * MIN);             // no bolus, uses insulin_units
  const m4 = meal("e4", 50, 0,  180 * MIN);             // no bolus, no insulin → excluded

  const b1 = bolus("b-e1", 7, 0, "e1");                 // explicit tag → m1
  const b2 = bolus("b-e2", 4, 60 * MIN + 10 * MIN);     // +10 min after m2 → time-window

  const r = computeAdaptiveICR([m1, m2, m3, m4], [b1, b2]);

  expect(r.sampleSize).toBe(3);                          // m4 excluded
  expect(r.pairedCount).toBe(2);                         // m1 (explicit) + m2 (time-window)
  expect(r.pairedExplicitCount).toBe(1);
  expect(r.pairedTimeWindowCount).toBe(1);

  // All three contributing meals have GOOD outcome (weight 1.0) →
  // simple average: (10 + 15 + 15) / 3 = 40/3.
  expect(r.global).toBeCloseTo(40 / 3, 4);
});

// ── Integration test: realistic multi-meal / multi-bolus scenario ─────
//
// 10 meals across morning, afternoon and evening. 7 bolus logs covering
// different pairing paths. Verifies the final weighted-average global
// ICR against a known expected value computed from the input.

test("pairing integration: 10 meals × 7 boluses → known global ICR", () => {
  // All meals are GOOD (delta=10) → weight 1.0 each.
  // ICR for each contributing meal = carbs / effective_insulin.
  //
  // Meal layout (FIXTURE_BASE_MS = 2026-04-30 08:00 UTC; times are offsets):
  //   M01   0 min  60g / explicit 6u  → ICR 10    (explicit pair B01)
  //   M02  30 min  60g / 0u           → ICR 12    (time-window B02 +5min)
  //   M03  60 min  45g / 3u           → ICR 15    (no bolus, uses insulin_units)
  //   M04  90 min  80g / 0u           → EXCLUDED  (no bolus, insulin_units=0)
  //   M05 240 min  90g / explicit 9u  → ICR 10    (explicit pair B05)
  //   M06 270 min  60g / 0u           → ICR 12    (time-window B06 -15min)
  //   M07 300 min  50g / 5u           → ICR 10    (no bolus, uses insulin_units)
  //   M08 540 min  70g / explicit 7u  → ICR 10    (explicit pair B08)
  //   M09 660 min  60g / 0u           → ICR 15    (time-window B09 +20min → 60/4)
  //   M10 720 min  50g / 0u           → EXCLUDED  (no bolus, insulin_units=0)
  //
  // Bolus positions chosen so no bolus lands within ±30 min of an
  // unintended meal (verified for each bolus below).
  //
  // Contributing: M01(10) M02(12) M03(15) M05(10) M06(12) M07(10) M08(10) M09(15)
  // Simple avg (all GOOD, weight 1.0) = (10+12+15+10+12+10+10+15)/8 = 94/8 = 11.75

  const offset = (h: number, m = 0) => (h * 60 + m) * MIN;

  const meals: Meal[] = [
    meal("M01", 60,  0, offset(0,  0)),   // explicit bolus
    meal("M02", 60,  0, offset(0, 30)),   // time-window bolus
    meal("M03", 45,  3, offset(1,  0)),   // insulin_units only
    meal("M04", 80,  0, offset(1, 30)),   // no bolus + insulin_units=0 → excluded
    meal("M05", 90,  0, offset(4,  0)),   // explicit bolus
    meal("M06", 60,  0, offset(4, 30)),   // time-window bolus
    meal("M07", 50,  5, offset(5,  0)),   // insulin_units only
    meal("M08", 70,  0, offset(9,  0)),   // explicit bolus
    meal("M09", 60,  0, offset(11, 0)),   // time-window bolus
    meal("M10", 50,  0, offset(12, 0)),   // no bolus + insulin_units=0 → excluded
  ];

  const boluses: InsulinLog[] = [
    // B01 at 0 min, explicit M01.  Nearest untagged meals: M02(30 min away).
    bolus("B01",  6, offset(0,  0),  "M01"),
    // B02 at 35 min.  Nearest: M02(5 min) → pairs. M01 covered. M03(25 min) not selected (farther).
    bolus("B02",  5, offset(0, 35)),
    // B05 at 240 min, explicit M05.
    bolus("B05",  9, offset(4,  0),  "M05"),
    // B06 at 255 min.  Nearest uncovered: M06(15 min). M05 already covered. M07(45 min) out of window.
    bolus("B06",  5, offset(4, 15)),
    // B08 at 540 min, explicit M08.
    bolus("B08",  7, offset(9,  0),  "M08"),
    // B09 at 680 min.  Nearest: M09(20 min). M10(40 min) out of window.
    bolus("B09",  4, offset(11, 20)),
    // Stray bolus far from all meals — must not pair with anything.
    bolus("B99",  2, offset(20, 0)),
  ];

  const r = computeAdaptiveICR(meals, boluses);

  expect(r.sampleSize).toBe(8);
  expect(r.pairedCount).toBe(6);                             // M01+M05+M08 explicit, M02+M06+M09 time-window
  expect(r.pairedExplicitCount).toBe(3);
  expect(r.pairedTimeWindowCount).toBe(3);
  expect(r.global).toBeCloseTo(94 / 8, 3);                   // 11.75
});
