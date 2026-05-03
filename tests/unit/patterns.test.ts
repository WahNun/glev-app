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
//   5. Threshold rules: overdose>50%, underdose>50%, spike>40%.

import { test, expect } from "@playwright/test";

import { detectPattern } from "@/lib/engine/patterns";
import { makeFinalMeal } from "../support/engineFixtures";
import type { Meal } from "@/lib/meals";

/** Build n meals each producing the same delta (and therefore outcome). */
function meals(n: number, delta: number, idPrefix = "m"): Meal[] {
  return Array.from({ length: n }, (_, i) => makeFinalMeal(`${idPrefix}-${i}`, delta));
}

// ── insufficient_data ───────────────────────────────────────────────

test("detectPattern: returns insufficient_data when fewer than 5 final meals", () => {
  const r = detectPattern(meals(4, 10));
  expect(r.type).toBe("insufficient_data");
  expect(r.confidence).toBe("low");
  expect(r.sampleSize).toBe(4);
  expect(r.explanation).toMatch(/Need at least 5 meals/);
});

test("detectPattern: empty array still returns insufficient_data", () => {
  const r = detectPattern([]);
  expect(r.type).toBe("insufficient_data");
  expect(r.sampleSize).toBe(0);
});

// ── balanced ────────────────────────────────────────────────────────

test("detectPattern: 5+ GOOD meals → balanced (boundary at n=5)", () => {
  const r = detectPattern(meals(5, 10));
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
  const r = detectPattern(list);
  expect(r.type).toBe("overdosing");
  expect(r.counts.overdose).toBe(6);
  expect(r.counts.good).toBe(4);
});

test("detectPattern: exactly 50% OVERDOSE is NOT overdosing (strict >)", () => {
  // 5 OVERDOSE + 5 GOOD = 50% → falls through to balanced.
  const list = [
    ...meals(5, -50, "over"),
    ...meals(5, 10, "good"),
  ];
  const r = detectPattern(list);
  expect(r.type).toBe("balanced");
});

// ── underdosing ─────────────────────────────────────────────────────

test("detectPattern: >50% UNDERDOSE → underdosing", () => {
  const list = [
    ...meals(6, 45, "under"),  // delta 45, default cutoff 55 → UNDERDOSE
    ...meals(4, 10, "good"),
  ];
  const r = detectPattern(list);
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
  const r = detectPattern(list);
  expect(r.type).toBe("spiking");
  expect(r.counts.spike).toBe(5);
});

test("detectPattern: exactly 40% SPIKE is NOT spiking (strict >)", () => {
  // 4 SPIKE + 6 GOOD = 40% → falls through to balanced.
  const list = [
    ...meals(4, 80, "spike"),
    ...meals(6, 10, "good"),
  ];
  const r = detectPattern(list);
  expect(r.type).toBe("balanced");
});

// ── confidence tiers ────────────────────────────────────────────────

test("detectPattern: confidence is medium at n=10 (boundary)", () => {
  const r = detectPattern(meals(10, 10));
  expect(r.type).toBe("balanced");
  expect(r.confidence).toBe("medium");
});

test("detectPattern: confidence is high at n=15 (boundary)", () => {
  const r = detectPattern(meals(15, 10));
  expect(r.confidence).toBe("high");
});

test("detectPattern: confidence is low when 5 ≤ n < 10", () => {
  const r = detectPattern(meals(9, 10));
  expect(r.confidence).toBe("low");
});

// ── 20-meal sliding window ──────────────────────────────────────────

test("detectPattern: only the most-recent 20 final meals contribute", () => {
  // 25 GOOD meals — should still cap sampleSize at 20.
  const r = detectPattern(meals(25, 10));
  expect(r.sampleSize).toBe(20);
  expect(r.counts.good).toBe(20);
  expect(r.confidence).toBe("high");
});
