// Unit coverage for `lib/engine/evaluation.ts` — the deterministic
// post-hoc outcome labeller used everywhere meals get scored.
//
// Locks in:
//   1. delta-based outcome (with bgAfter): GOOD / UNDERDOSE / OVERDOSE / SPIKE
//      across all four classification spike thresholds (FAST_CARBS=70,
//      HIGH_PROTEIN=50, HIGH_FAT=40, BALANCED=55).
//   2. ICR-ratio fallback (no bgAfter): OVERDOSE >1.35, UNDERDOSE <0.65,
//      else GOOD with confidence "low".
//   3. speedSuffix renders mg/dL/min with the rose/fell verb and sign.
//   4. contextSuffix surfaces a recent basal dose (≤24h) and a recent
//      exercise session (≤4h).
//   5. Settings fallback path — when no `settings` is passed and we run
//      server-side (no window), getInsulinSettings() returns the
//      DEFAULT_INSULIN_SETTINGS (15/50/110), so the ICR-ratio fallback
//      uses 15g/u as expected.
//
// Runs as a Playwright unit test (no browser, no dev server) — same
// convention as tests/unit/lifecycle.test.ts and tests/unit/exerciseEval.test.ts.

import { test, expect } from "@playwright/test";

import { evaluateEntry } from "@/lib/engine/evaluation";
import { makeInsulinLog, makeExerciseLog } from "../support/engineFixtures";

// ── delta-based outcomes (bgAfter present) ──────────────────────────

test("evaluateEntry: GOOD when |delta| ≤ 30", () => {
  const r = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110 });
  expect(r.outcome).toBe("GOOD");
  expect(r.delta).toBe(10);
  expect(r.reasoning).toMatch(/Δ\+10/);
});

test("evaluateEntry: UNDERDOSE when 30 < delta ≤ spike cutoff", () => {
  const r = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 145 }); // delta 45, default cutoff 55
  expect(r.outcome).toBe("UNDERDOSE");
  expect(r.delta).toBe(45);
});

test("evaluateEntry: SPIKE when delta exceeds the BALANCED 55 cutoff", () => {
  const r = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 160 });
  expect(r.outcome).toBe("SPIKE");
  expect(r.reasoning).toMatch(/balanced meals/);
});

test("evaluateEntry: OVERDOSE when delta < -30", () => {
  const r = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 60 });
  expect(r.outcome).toBe("OVERDOSE");
  expect(r.delta).toBe(-40);
});

test("evaluateEntry: FAST_CARBS spike threshold is 70 mg/dL", () => {
  // delta=65 → still UNDERDOSE for fast-carb meals.
  const under = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 165, classification: "FAST_CARBS" });
  expect(under.outcome).toBe("UNDERDOSE");
  // delta=80 → SPIKE.
  const spike = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 180, classification: "FAST_CARBS" });
  expect(spike.outcome).toBe("SPIKE");
  expect(spike.reasoning).toMatch(/fast-carb meals/);
});

test("evaluateEntry: HIGH_FAT spike threshold is 40 mg/dL (early rise more suspicious)", () => {
  const r = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 145, classification: "HIGH_FAT" });
  expect(r.outcome).toBe("SPIKE");
  expect(r.reasoning).toMatch(/high-fat meals/);
});

test("evaluateEntry: HIGH_PROTEIN spike threshold is 50 mg/dL", () => {
  const balanced = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 145, classification: "HIGH_PROTEIN" });
  // delta 45 < 50 cutoff → UNDERDOSE not SPIKE.
  expect(balanced.outcome).toBe("UNDERDOSE");
  const spike = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 155, classification: "HIGH_PROTEIN" });
  expect(spike.outcome).toBe("SPIKE");
});

test("evaluateEntry: netCarbs subtracts fiber from carbs", () => {
  const r = evaluateEntry({ carbs: 50, fiber: 8, insulin: 4, bgBefore: 100, bgAfter: 110 });
  expect(r.netCarbs).toBe(42);
});

// ── ICR-ratio fallback (no bgAfter) ─────────────────────────────────

test("evaluateEntry fallback: GOOD when dose is within ±35% of expected", () => {
  // 60g / 15g/u = 4u expected; insulin=4u → ratio 1.0
  const r = evaluateEntry({ carbs: 60, insulin: 4, bgBefore: 110, settings: { icr: 15, cf: 50, targetBg: 110 } });
  expect(r.outcome).toBe("GOOD");
  expect(r.delta).toBeNull();
  expect(r.confidence).toBe("low");
  expect(r.reasoning).toMatch(/ICR-expected/);
});

test("evaluateEntry fallback: OVERDOSE when ratio > 1.35", () => {
  // expected 4u, given 6u → ratio 1.5
  const r = evaluateEntry({ carbs: 60, insulin: 6, bgBefore: 110, settings: { icr: 15, cf: 50, targetBg: 110 } });
  expect(r.outcome).toBe("OVERDOSE");
});

test("evaluateEntry fallback: UNDERDOSE when ratio < 0.65", () => {
  // expected 4u, given 2u → ratio 0.5
  const r = evaluateEntry({ carbs: 60, insulin: 2, bgBefore: 110, settings: { icr: 15, cf: 50, targetBg: 110 } });
  expect(r.outcome).toBe("UNDERDOSE");
});

test("evaluateEntry fallback: high BG adds a correction term to expected dose", () => {
  // carbs=15 → 1u; bgBefore=200 → +90/50 = 1.8u correction; expected ≈ 2.8u.
  // insulin=2.8u → ratio ≈ 1.0 → GOOD.
  const r = evaluateEntry({ carbs: 15, insulin: 2.8, bgBefore: 200, settings: { icr: 15, cf: 50, targetBg: 110 } });
  expect(r.outcome).toBe("GOOD");
});

test("evaluateEntry fallback: settings default path uses 15/50/110 server-side", () => {
  // No `settings` passed → getInsulinSettings() runs; on the server
  // (vitest/playwright node env, no `window`) it returns DEFAULT (15/50/110)
  // without a console warning. We verify the math matches the defaults.
  const r = evaluateEntry({ carbs: 60, insulin: 4, bgBefore: 110 });
  expect(r.outcome).toBe("GOOD");
});

// ── speed suffix ────────────────────────────────────────────────────

test("speedSuffix renders +1.00 mg/dL/min for a rising speed1", () => {
  const r = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110, speed1: 1 });
  expect(r.reasoning).toMatch(/BG rose at \+1\.00 mg\/dL\/min in the first hour\./);
});

test("speedSuffix renders -0.50 mg/dL/min for a falling speed2", () => {
  const r = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110, speed2: -0.5 });
  expect(r.reasoning).toMatch(/BG fell at -0\.50 mg\/dL\/min over the 2-hour window\./);
});

test("speedSuffix is omitted when both speeds are null/undefined", () => {
  const r = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110 });
  expect(r.reasoning).not.toMatch(/mg\/dL\/min/);
});

// ── context suffix ──────────────────────────────────────────────────

test("contextSuffix mentions a recent basal dose (≤24h)", () => {
  const basal = makeInsulinLog({
    insulin_type: "basal",
    insulin_name: "Tresiba",
    units: 12,
    created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  });
  const r = evaluateEntry({
    carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110,
    recentInsulinLogs: [basal],
  });
  expect(r.reasoning).toMatch(/Basal-Kontext: 12u Tresiba vor 3h/);
});

test("contextSuffix mentions a recent exercise session (≤4h)", () => {
  const ex = makeExerciseLog({
    exercise_type: "run",
    duration_minutes: 45,
    intensity: "high",
    created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  });
  const r = evaluateEntry({
    carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110,
    recentExerciseLogs: [ex],
  });
  expect(r.reasoning).toMatch(/Bewegung: 45 min run \(high\) in den letzten 4h/);
});

test("contextSuffix is empty when logs are stale (basal >24h, exercise >4h)", () => {
  const oldBasal = makeInsulinLog({
    insulin_type: "basal",
    created_at: new Date(Date.now() - 36 * 3600_000).toISOString(),
  });
  const oldExercise = makeExerciseLog({
    created_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
  });
  const r = evaluateEntry({
    carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110,
    recentInsulinLogs: [oldBasal],
    recentExerciseLogs: [oldExercise],
  });
  expect(r.reasoning).not.toMatch(/Basal-Kontext/);
  expect(r.reasoning).not.toMatch(/Bewegung/);
});

// ── confidence ──────────────────────────────────────────────────────

test("evaluateEntry confidence is medium for moderate |delta| (>25, ≤80)", () => {
  const r = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 140 });
  expect(r.confidence).toBe("medium");
});

test("evaluateEntry confidence is high for big |delta| (>80)", () => {
  const r = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 200 });
  expect(r.confidence).toBe("high");
});

// ── Pre-Meal-Trend (Task #195) ──────────────────────────────────────

test("evaluateEntry: preTrend appends trend message, outcome unchanged", () => {
  const baseInput = { carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110 };
  const without = evaluateEntry(baseInput);
  const withTrend = evaluateEntry({ ...baseInput, preTrend: "falling_fast" });
  expect(withTrend.outcome).toBe(without.outcome);
  expect(withTrend.messages.some(m => m.key === "engine_eval_trend_falling_fast")).toBe(true);
});

test("evaluateEntry: no preTrend → no trend message", () => {
  const r = evaluateEntry({ carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110 });
  expect(r.messages.some(m => m.key.startsWith("engine_eval_trend_"))).toBe(false);
});
