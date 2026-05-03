// Unit coverage for `lib/engine/patterns.ts` — the rolling-window
// pattern detector used by the Insights "Personal Pattern" panel.
//
// Locks in:
//   1. All 5 PatternType values: insufficient_data, overdosing,
//      underdosing, spiking, balanced.
//   2. Confidence tiers: <10=low, ≥10=medium, ≥15=high (plus the n<5
//      gate which returns insufficient_data with confidence "low").
//   3. The 5/10/15 boundary conditions don't off-by-one.
//   4. The 20-meal sliding window (only the most-recent 20 final meals
//      contribute).
//   5. Threshold rules: overdose>50%, underdose>50%, spike>40% — applied
//      to recency-weighted shares (Task #189).
//   6. The 30-day cutoff: meals older than `WINDOW_DAYS` are filtered
//      out before the slice; <5 meals in the window → insufficient_data
//      with the "in the last 30 days" wording.
//   7. Recency weight: within the window, freshest meal weighs 1.0 and
//      meals at the cutoff weigh 0.5 (linear), so a 4-week-old burst
//      can't out-vote a 1-week-old trend.

import { test, expect } from "@playwright/test";

import { detectPattern } from "@/lib/engine/patterns";
import { makeFinalMeal } from "../support/engineFixtures";
import type { Meal } from "@/lib/meals";

// All meal_times are computed relative to this anchor (instead of the
// real wall clock), so the 30-day cutoff behaves identically no matter
// when the suite runs.
const NOW = new Date("2026-05-03T12:00:00Z");
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** Build n meals each producing the same delta (and therefore outcome),
 *  spaced one hour apart ending at NOW so every meal sits comfortably
 *  inside the 30-day window. */
function meals(n: number, delta: number, idPrefix = "m"): Meal[] {
  return Array.from({ length: n }, (_, i) =>
    makeFinalMeal(`${idPrefix}-${i}`, delta, {
      meal_time: new Date(NOW.getTime() - (i + 1) * HOUR_MS).toISOString(),
    }),
  );
}

/** Build a single meal at a specific age (in days before NOW). */
function mealAtDaysAgo(id: string, delta: number, daysAgo: number): Meal {
  return makeFinalMeal(id, delta, {
    meal_time: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(),
  });
}

// ── insufficient_data ───────────────────────────────────────────────

test("detectPattern: returns insufficient_data when fewer than 5 final meals", () => {
  const r = detectPattern(meals(4, 10), NOW);
  expect(r.type).toBe("insufficient_data");
  expect(r.confidence).toBe("low");
  expect(r.sampleSize).toBe(4);
  expect(r.explanation).toMatch(/Need at least 5 meals/);
  expect(r.explanation).toMatch(/last 30 days/);
});

test("detectPattern: empty array still returns insufficient_data", () => {
  const r = detectPattern([], NOW);
  expect(r.type).toBe("insufficient_data");
  expect(r.sampleSize).toBe(0);
});

// ── balanced ────────────────────────────────────────────────────────

test("detectPattern: 5+ GOOD meals → balanced (boundary at n=5)", () => {
  const r = detectPattern(meals(5, 10), NOW);
  expect(r.type).toBe("balanced");
  expect(r.confidence).toBe("low"); // 5 ≤ n < 10 → low
  expect(r.counts.good).toBe(5);
  expect(r.sampleSize).toBe(5);
});

// ── overdosing ──────────────────────────────────────────────────────

test("detectPattern: >50% OVERDOSE → overdosing", () => {
  // 6 OVERDOSE + 4 GOOD = 60% → overdosing.
  const list = [
    ...meals(6, -50, "over"), // delta < -30 → OVERDOSE
    ...meals(4, 10, "good"),
  ];
  const r = detectPattern(list, NOW);
  expect(r.type).toBe("overdosing");
  expect(r.counts.overdose).toBe(6);
  expect(r.counts.good).toBe(4);
});

test("detectPattern: exactly 50% OVERDOSE is NOT overdosing (strict >)", () => {
  // 5 OVERDOSE + 5 GOOD all at the same meal_time → equal weights, so
  // weighted share is exactly 50%, falls through to balanced.
  const sameTime = new Date(NOW.getTime() - HOUR_MS).toISOString();
  const list = [
    ...Array.from({ length: 5 }, (_, i) => makeFinalMeal(`over-${i}`, -50, { meal_time: sameTime })),
    ...Array.from({ length: 5 }, (_, i) => makeFinalMeal(`good-${i}`, 10,  { meal_time: sameTime })),
  ];
  const r = detectPattern(list, NOW);
  expect(r.type).toBe("balanced");
});

// ── underdosing ─────────────────────────────────────────────────────

test("detectPattern: >50% UNDERDOSE → underdosing", () => {
  const list = [
    ...meals(6, 45, "under"),  // delta 45, default cutoff 55 → UNDERDOSE
    ...meals(4, 10, "good"),
  ];
  const r = detectPattern(list, NOW);
  expect(r.type).toBe("underdosing");
  expect(r.counts.underdose).toBe(6);
});

// ── spiking ─────────────────────────────────────────────────────────

test("detectPattern: >40% SPIKE → spiking", () => {
  // 5 SPIKE + 5 GOOD = 50% spike → spiking.
  const list = [
    ...meals(5, 80, "spike"),  // delta 80 > 55 → SPIKE
    ...meals(5, 10, "good"),
  ];
  const r = detectPattern(list, NOW);
  expect(r.type).toBe("spiking");
  expect(r.counts.spike).toBe(5);
});

test("detectPattern: exactly 40% SPIKE is NOT spiking (strict >)", () => {
  // 4 SPIKE + 6 GOOD all at the same meal_time → 40% weighted share,
  // strict `>` falls through to balanced.
  const sameTime = new Date(NOW.getTime() - HOUR_MS).toISOString();
  const list = [
    ...Array.from({ length: 4 }, (_, i) => makeFinalMeal(`spike-${i}`, 80, { meal_time: sameTime })),
    ...Array.from({ length: 6 }, (_, i) => makeFinalMeal(`good-${i}`, 10,  { meal_time: sameTime })),
  ];
  const r = detectPattern(list, NOW);
  expect(r.type).toBe("balanced");
});

// ── confidence tiers ────────────────────────────────────────────────

test("detectPattern: confidence is medium at n=10 (boundary)", () => {
  const r = detectPattern(meals(10, 10), NOW);
  expect(r.type).toBe("balanced");
  expect(r.confidence).toBe("medium");
});

test("detectPattern: confidence is high at n=15 (boundary)", () => {
  const r = detectPattern(meals(15, 10), NOW);
  expect(r.confidence).toBe("high");
});

test("detectPattern: confidence is low when 5 ≤ n < 10", () => {
  const r = detectPattern(meals(9, 10), NOW);
  expect(r.confidence).toBe("low");
});

// ── 20-meal sliding window ──────────────────────────────────────────

test("detectPattern: only the most-recent 20 final meals contribute", () => {
  // 25 GOOD meals — should still cap sampleSize at 20.
  const r = detectPattern(meals(25, 10), NOW);
  expect(r.sampleSize).toBe(20);
  expect(r.counts.good).toBe(20);
  expect(r.confidence).toBe("high");
});

// ── 30-day cutoff (Task #189) ───────────────────────────────────────

test("detectPattern: meals older than 30 days are excluded from the window", () => {
  // 4 fresh GOOD meals + 10 OVERDOSE meals from 6 months ago. The old
  // burst would historically dominate; with the cutoff it must vanish,
  // leaving only 4 in the window → insufficient_data.
  const list = [
    ...Array.from({ length: 4 }, (_, i) => mealAtDaysAgo(`fresh-${i}`, 10, 1)),
    ...Array.from({ length: 10 }, (_, i) => mealAtDaysAgo(`old-${i}`, -50, 180)),
  ];
  const r = detectPattern(list, NOW);
  expect(r.type).toBe("insufficient_data");
  expect(r.sampleSize).toBe(4);
  expect(r.counts.overdose).toBe(0);
  expect(r.explanation).toMatch(/last 30 days/);
});

test("detectPattern: meal exactly at the 30-day cutoff is INCLUDED", () => {
  // 5 meals all at exactly 30 days ago → the boundary is `>= cutoff`,
  // so they should still count.
  const list = Array.from({ length: 5 }, (_, i) => mealAtDaysAgo(`edge-${i}`, 10, 30));
  const r = detectPattern(list, NOW);
  expect(r.type).toBe("balanced");
  expect(r.sampleSize).toBe(5);
});

test("detectPattern: meal at 31 days ago is EXCLUDED", () => {
  const list = [
    ...Array.from({ length: 4 }, (_, i) => mealAtDaysAgo(`fresh-${i}`, 10, 1)),
    mealAtDaysAgo("stale", 10, 31),
  ];
  const r = detectPattern(list, NOW);
  // 4 fresh meals → still under the 5-meal floor.
  expect(r.type).toBe("insufficient_data");
  expect(r.sampleSize).toBe(4);
});

// ── recency weighting (Task #189) ───────────────────────────────────

test("detectPattern: a recent OVERDOSE burst out-votes an older GOOD burst", () => {
  // 5 OVERDOSE meals at ~1 day old (weight ≈ 0.983 each → ≈ 4.92)
  // 5 GOOD meals at ~28 days old (weight ≈ 0.533 each → ≈ 2.67)
  // Raw rate: 50% / 50% — would NOT trip the strict `> 50%` overdose rule.
  // Weighted: ~64.8% overdose → trips the rule.
  const list = [
    ...Array.from({ length: 5 }, (_, i) => mealAtDaysAgo(`recent-${i}`, -50, 1)),
    ...Array.from({ length: 5 }, (_, i) => mealAtDaysAgo(`older-${i}`, 10, 28)),
  ];
  const r = detectPattern(list, NOW);
  expect(r.type).toBe("overdosing");
  expect(r.counts.overdose).toBe(5);
  expect(r.counts.good).toBe(5);
});

test("detectPattern: an older OVERDOSE burst is dampened by recent GOOD meals", () => {
  // Mirror of the above: 5 OVERDOSE at ~28 days old vs 5 GOOD at ~1
  // day old. Raw 50/50 again, but the weighted overdose share now sits
  // around ~35% — well below the threshold → balanced wins.
  const list = [
    ...Array.from({ length: 5 }, (_, i) => mealAtDaysAgo(`old-${i}`, -50, 28)),
    ...Array.from({ length: 5 }, (_, i) => mealAtDaysAgo(`new-${i}`, 10, 1)),
  ];
  const r = detectPattern(list, NOW);
  expect(r.type).toBe("balanced");
});
