// Regression guard for the IOB 0,0 bug (Task #470).
//
// The bug: IOBCard showed 0.0 IE because it only looked at `insulin_logs`
// and ignored `meals.insulin_units` — the primary source for doses entered
// via the meal-log wizard, which never writes to `insulin_logs`.
//
// These tests lock in the three key invariants of `buildDoses` (lib/iob.ts):
//   1. Meal.insulin_units without a linked log contributes to IOB (was broken).
//   2. A meal linked via related_entry_id in an insulin_log is NOT double-counted.
//   3. Doses elapsed beyond DIA minutes contribute 0 to IOB.

import { test, expect } from "@playwright/test";
import { buildDoses, calcTotalIOB, getDIAMinutes } from "@/lib/iob";
import type { InsulinLike, MealLike } from "@/lib/iob";

// ── helpers ─────────────────────────────────────────────────────────────────

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function makeInsulin(overrides: Partial<InsulinLike> = {}): InsulinLike {
  return {
    insulin_type: "bolus",
    units: 4,
    created_at: isoMinutesAgo(30),
    related_entry_id: null,
    ...overrides,
  };
}

function makeMeal(overrides: Partial<MealLike> & { id: string }): MealLike {
  return {
    insulin_units: 4,
    meal_time: isoMinutesAgo(30),
    created_at: isoMinutesAgo(30),
    ...overrides,
  };
}

// ── 1. Meal insulin_units WITHOUT a linked log → IOB > 0 ────────────────────
//
// This is the core regression: no insulin_logs, but meal has insulin_units.
// buildDoses must include those units so calcTotalIOB returns > 0.

test("buildDoses: meal.insulin_units contributes to IOB when no insulin_logs present", () => {
  const meals: MealLike[] = [makeMeal({ id: "m1", insulin_units: 4 })];
  const doses = buildDoses([], meals);
  expect(doses).toHaveLength(1);
  expect(doses[0].units).toBe(4);
});

test("calcTotalIOB > 0 when only meal.insulin_units are provided (0,0 regression)", () => {
  const meals: MealLike[] = [makeMeal({ id: "m1", insulin_units: 3 })];
  const doses = buildDoses([], meals);
  const iob = calcTotalIOB(doses, "rapid");
  expect(iob).toBeGreaterThan(0);
});

test("buildDoses: multiple meals all contribute when no linked logs", () => {
  const meals: MealLike[] = [
    makeMeal({ id: "m1", insulin_units: 3, meal_time: isoMinutesAgo(20) }),
    makeMeal({ id: "m2", insulin_units: 5, meal_time: isoMinutesAgo(60) }),
  ];
  const doses = buildDoses([], meals);
  expect(doses).toHaveLength(2);
  const iob = calcTotalIOB(doses, "rapid");
  expect(iob).toBeGreaterThan(0);
});

test("buildDoses: meal with null insulin_units is ignored", () => {
  const meals: MealLike[] = [makeMeal({ id: "m1", insulin_units: null })];
  const doses = buildDoses([], meals);
  expect(doses).toHaveLength(0);
});

test("buildDoses: meal with 0 insulin_units is ignored", () => {
  const meals: MealLike[] = [makeMeal({ id: "m1", insulin_units: 0 })];
  const doses = buildDoses([], meals);
  expect(doses).toHaveLength(0);
});

test("buildDoses: meal uses meal_time as administeredAt when available", () => {
  const mealTime = isoMinutesAgo(45);
  const meals: MealLike[] = [makeMeal({ id: "m1", meal_time: mealTime })];
  const doses = buildDoses([], meals);
  expect(doses[0].administeredAt).toBe(mealTime);
});

test("buildDoses: meal falls back to created_at when meal_time is null", () => {
  const createdAt = isoMinutesAgo(50);
  const meals: MealLike[] = [makeMeal({ id: "m1", meal_time: null, created_at: createdAt })];
  const doses = buildDoses([], meals);
  expect(doses[0].administeredAt).toBe(createdAt);
});

// ── 2. Double-count guard: meal linked via related_entry_id is skipped ───────
//
// When the user explicitly tags a bolus log to a meal, the bolus log already
// represents that dose. The meal's insulin_units must NOT be added again.

test("buildDoses: meal linked via related_entry_id is NOT added (no double-count)", () => {
  const insulin: InsulinLike[] = [
    makeInsulin({ related_entry_id: "m1" }),
  ];
  const meals: MealLike[] = [makeMeal({ id: "m1", insulin_units: 4 })];
  const doses = buildDoses(insulin, meals);
  // Only the bolus log — not the meal again
  expect(doses).toHaveLength(1);
  expect(doses[0].units).toBe(4);
});

test("buildDoses: only the linked meal is excluded, unlinked meals are still included", () => {
  const insulin: InsulinLike[] = [
    makeInsulin({ related_entry_id: "m1" }),
  ];
  const meals: MealLike[] = [
    makeMeal({ id: "m1", insulin_units: 4 }),
    makeMeal({ id: "m2", insulin_units: 6, meal_time: isoMinutesAgo(90) }),
  ];
  const doses = buildDoses(insulin, meals);
  // bolus log for m1 + unlinked m2 → 2 doses, total 10u
  expect(doses).toHaveLength(2);
  const totalUnits = doses.reduce((s, d) => s + d.units, 0);
  expect(totalUnits).toBe(10);
});

test("buildDoses: multiple linked meals are all excluded", () => {
  const insulin: InsulinLike[] = [
    makeInsulin({ related_entry_id: "m1" }),
    makeInsulin({ related_entry_id: "m2" }),
  ];
  const meals: MealLike[] = [
    makeMeal({ id: "m1", insulin_units: 4 }),
    makeMeal({ id: "m2", insulin_units: 6 }),
  ];
  const doses = buildDoses(insulin, meals);
  // 2 bolus logs — 0 meals (all linked)
  expect(doses).toHaveLength(2);
});

test("buildDoses: basal log is not added as a dose even without related_entry_id", () => {
  const insulin: InsulinLike[] = [makeInsulin({ insulin_type: "basal", units: 20 })];
  const doses = buildDoses(insulin, []);
  expect(doses).toHaveLength(0);
});

// ── 3. Expired doses (elapsed >= DIA) contribute 0 to IOB ───────────────────
//
// If a dose was administered more than DIA minutes ago, calcSingleIOB
// returns 0. calcTotalIOB must therefore also return 0 for such doses.

test("calcTotalIOB returns 0 for a dose administered exactly at DIA boundary", () => {
  const diaMin = getDIAMinutes("rapid");
  const doses = buildDoses([], [
    makeMeal({ id: "m1", insulin_units: 5, meal_time: isoMinutesAgo(diaMin) }),
  ]);
  const iob = calcTotalIOB(doses, "rapid");
  expect(iob).toBe(0);
});

test("calcTotalIOB returns 0 for a dose administered well beyond DIA", () => {
  const diaMin = getDIAMinutes("rapid");
  const doses = buildDoses([], [
    makeMeal({ id: "m1", insulin_units: 5, meal_time: isoMinutesAgo(diaMin + 60) }),
  ]);
  const iob = calcTotalIOB(doses, "rapid");
  expect(iob).toBe(0);
});

test("calcTotalIOB: only expired doses → 0, fresh doses still contribute", () => {
  const diaMin = getDIAMinutes("rapid");
  const doses = buildDoses([], [
    makeMeal({ id: "m1", insulin_units: 5, meal_time: isoMinutesAgo(diaMin + 30) }),
    makeMeal({ id: "m2", insulin_units: 3, meal_time: isoMinutesAgo(30) }),
  ]);
  const iob = calcTotalIOB(doses, "rapid");
  // m1 cleared → 0, m2 active → > 0
  expect(iob).toBeGreaterThan(0);
});

test("calcTotalIOB: dose 30 minutes before DIA clearance still contributes a small positive IOB", () => {
  // At (DIA - 30) min elapsed: ratio = (DIA-30)/DIA, residual = units*(1-ratio)^2
  // For rapid DIA=180: ratio = 150/180 = 0.833, residual = 10 * 0.028 ≈ 0.28 IE
  // That clears the 0.005 rounding threshold and proves decay hasn't hit zero yet.
  const diaMin = getDIAMinutes("rapid");
  const doses = buildDoses([], [
    makeMeal({ id: "m1", insulin_units: 10, meal_time: isoMinutesAgo(diaMin - 30) }),
  ]);
  const iob = calcTotalIOB(doses, "rapid");
  expect(iob).toBeGreaterThan(0);
  // 30 min before clearance, residual for 10u rapid should be well under 1u
  expect(iob).toBeLessThan(1);
});

test("getDIAMinutes: rapid=180, regular=300, unknown defaults to 180", () => {
  expect(getDIAMinutes("rapid")).toBe(180);
  expect(getDIAMinutes("regular")).toBe(300);
  expect(getDIAMinutes("unknown")).toBe(180);
});
