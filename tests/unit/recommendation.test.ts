// Unit coverage for `lib/engine/recommendation.ts` — the dose
// recommender consumed by the Engine page's "what should I dose?" UX.
//
// Locks in:
//   1. Safety floor: BG < 80 → blocked, all-zero dose, high confidence.
//   2. Hard ceiling: total > 25u is clamped to 25u + flagged in
//      reasoning.
//   3. ICR-source picker priority: time-of-day > global > default.
//      Non-positive / NaN learned values fall through to the next
//      tier (defensive against bad localStorage data).
//   4. Stacking warning: >2 bolus logs in the last 6h → reasoning
//      mentions Active Insulin.
//   5. Half-unit rounding: recommendedUnits is always a multiple of 0.5.
//   6. Confidence: default ICR → low; learned with sample≥10 → high;
//      sample≥5 → medium; else low.

import { test, expect } from "@playwright/test";

import { recommendDose } from "@/lib/engine/recommendation";
import { makeAdaptiveICR, makeInsulinLog, makeExerciseLog } from "../support/engineFixtures";

// ── safety floor ────────────────────────────────────────────────────

test("recommendDose: BG < 80 blocks the dose entirely", () => {
  const r = recommendDose({
    carbs: 60,
    currentBG: 70,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
  });
  expect(r.blocked).toBe(true);
  expect(r.recommendedUnits).toBe(0);
  expect(r.carbDose).toBe(0);
  expect(r.correctionDose).toBe(0);
  expect(r.confidence).toBe("high");
  expect(r.reasoning).toMatch(/safety floor/);
});

// ── hard ceiling ────────────────────────────────────────────────────

test("recommendDose: total dose above 25u is clamped to 25u and flagged", () => {
  // 500g / 10 = 50u → way over ceiling.
  const r = recommendDose({
    carbs: 500,
    currentBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 10, sampleSize: 20 }),
  });
  expect(r.recommendedUnits).toBe(25);
  expect(r.reasoning).toMatch(/Clamped to safety ceiling of 25u/);
});

// ── ICR-source picker ───────────────────────────────────────────────

test("recommendDose: prefers time-of-day ICR when available", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    timeOfDay: "morning",
    adaptiveICR: makeAdaptiveICR({ global: 20, morning: 10, sampleSize: 20 }),
  });
  expect(r.icrSource).toBe("morning");
  expect(r.icrUsed).toBe(10);
  expect(r.carbDose).toBe(3); // 30/10
});

test("recommendDose: falls back to global when time-of-day bucket is null", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    timeOfDay: "morning",
    adaptiveICR: makeAdaptiveICR({ global: 20, morning: null, sampleSize: 20 }),
  });
  expect(r.icrSource).toBe("global");
  expect(r.icrUsed).toBe(20);
});

test("recommendDose: falls back to default ICR=15 when nothing learned", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    adaptiveICR: makeAdaptiveICR(),
  });
  expect(r.icrSource).toBe("default");
  expect(r.icrUsed).toBe(15);
  expect(r.confidence).toBe("low");
});

test("recommendDose: skips non-positive learned ICR (defensive against bad data)", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    timeOfDay: "morning",
    adaptiveICR: makeAdaptiveICR({ global: 20, morning: -1, sampleSize: 20 }),
  });
  expect(r.icrSource).toBe("global");
});

// ── correction dose ─────────────────────────────────────────────────

test("recommendDose: correction dose triggers only when BG > target", () => {
  // currentBG 200, target 100, cf 50 → +2u correction.
  const r = recommendDose({
    carbs: 0,
    currentBG: 200,
    targetBG: 100,
    correctionFactor: 50,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
  });
  expect(r.correctionDose).toBe(2);
  expect(r.carbDose).toBe(0);
  expect(r.recommendedUnits).toBe(2);
});

test("recommendDose: no correction when BG ≤ target", () => {
  const r = recommendDose({
    carbs: 0,
    currentBG: 90,
    targetBG: 100,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
  });
  expect(r.correctionDose).toBe(0);
});

// ── half-unit rounding ──────────────────────────────────────────────

test("recommendDose: recommendedUnits is rounded to nearest 0.5u", () => {
  // 47g / 15 ≈ 3.133u; BG = targetBG = 100 → no correction term.
  const r = recommendDose({
    carbs: 47,
    currentBG: 100,
    targetBG: 100,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
  });
  // 3.133 * 2 = 6.27 → round = 6 → /2 = 3.0
  expect(r.recommendedUnits).toBe(3.0);
  expect((r.recommendedUnits * 2) % 1).toBe(0);
});

test("recommendDose: 0.6 → 0.5 and 0.8 → 1.0 (half-unit rounding spot-check)", () => {
  // BG = targetBG so the carb-only dose is what we're rounding.
  const a = recommendDose({
    carbs: 9, currentBG: 100, targetBG: 100,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
  });
  // 9/15 = 0.6 → *2=1.2 → round=1 → /2 = 0.5
  expect(a.recommendedUnits).toBe(0.5);
  const b = recommendDose({
    carbs: 12, currentBG: 100, targetBG: 100,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
  });
  // 12/15 = 0.8 → *2=1.6 → round=2 → /2 = 1.0
  expect(b.recommendedUnits).toBe(1.0);
});

// ── confidence tiers ────────────────────────────────────────────────

test("recommendDose: confidence high when learned ICR has ≥10 samples", () => {
  const r = recommendDose({ carbs: 30, currentBG: 110, adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 10 }) });
  expect(r.confidence).toBe("high");
});

test("recommendDose: confidence medium when learned ICR has 5–9 samples", () => {
  const r = recommendDose({ carbs: 30, currentBG: 110, adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 5 }) });
  expect(r.confidence).toBe("medium");
});

test("recommendDose: confidence low when learned ICR has <5 samples", () => {
  const r = recommendDose({ carbs: 30, currentBG: 110, adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 4 }) });
  expect(r.confidence).toBe("low");
});

// ── stacking warning ────────────────────────────────────────────────

test("recommendDose: more than 2 bolus logs within 6h → stacking warning", () => {
  const recent = Array.from({ length: 3 }, (_, i) =>
    makeInsulinLog({ id: `b${i}`, insulin_type: "bolus", units: 4, created_at: new Date(Date.now() - (i + 1) * 3600_000).toISOString() }),
  );
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
    recentInsulinLogs: recent,
  });
  expect(r.reasoning).toMatch(/3 Bolus-Dosen in den letzten 6h/);
  expect(r.reasoning).toMatch(/Active Insulin/);
});

test("recommendDose: 2 or fewer recent boluses → no stacking warning", () => {
  const recent = [
    makeInsulinLog({ id: "b1", insulin_type: "bolus", units: 4, created_at: new Date(Date.now() - 1 * 3600_000).toISOString() }),
    makeInsulinLog({ id: "b2", insulin_type: "bolus", units: 4, created_at: new Date(Date.now() - 2 * 3600_000).toISOString() }),
  ];
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
    recentInsulinLogs: recent,
  });
  expect(r.reasoning).not.toMatch(/Bolus-Dosen in den letzten 6h/);
});

// ── basal context ───────────────────────────────────────────────────

test("recommendDose: surfaces the most-recent basal dose within 24h", () => {
  const basal = makeInsulinLog({
    insulin_type: "basal",
    insulin_name: "Tresiba",
    units: 12,
    created_at: new Date(Date.now() - 8 * 3600_000).toISOString(),
  });
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
    recentInsulinLogs: [basal],
  });
  expect(r.reasoning).toMatch(/Basal: 12u Tresiba vor 8h/);
});

// ── exercise sensitivity ────────────────────────────────────────────

test("recommendDose: exercise within 4h → sensitivity hint in reasoning", () => {
  const ex = makeExerciseLog({
    exercise_type: "run",
    duration_minutes: 45,
    intensity: "high",
    created_at: new Date(Date.now() - 1 * 3600_000).toISOString(),
  });
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
    recentExerciseLogs: [ex],
  });
  expect(r.reasoning).toMatch(/45 min run \(high\)/);
  expect(r.reasoning).toMatch(/erhöhte Insulin-Sensitivität/);
});

// ── empty / null currentBG ──────────────────────────────────────────

test("recommendDose: null currentBG skips the safety check and the correction dose", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: null,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
  });
  expect(r.blocked).toBe(false);
  expect(r.correctionDose).toBe(0);
  expect(r.carbDose).toBe(2);
});

test("recommendDose: 0 carbs and BG within target → no dose, explanatory message", () => {
  const r = recommendDose({
    carbs: 0,
    currentBG: 100,
    targetBG: 100,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
  });
  expect(r.recommendedUnits).toBe(0);
  expect(r.reasoning).toMatch(/No carbs and BG within target/);
});

// ── Pre-Meal-Trend (Task #195) ──────────────────────────────────────
//
// `preTrend` darf die Dosis nicht ändern (Compliance: v1 ist strikt
// Doku), muss aber als zusätzlicher Reasoning-Satz auftauchen. Bei
// `rising_fast` knapp über dem Ziel-BG zusätzlich der Overshoot-Hinweis.

test("recommendDose: preTrend rising → trend message appended, dose unchanged", () => {
  const baseInput = {
    carbs: 30,
    currentBG: 110,
    targetBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
  };
  const without = recommendDose(baseInput);
  const withTrend = recommendDose({ ...baseInput, preTrend: "rising" });
  expect(withTrend.recommendedUnits).toBe(without.recommendedUnits);
  expect(withTrend.messages.some(m => m.key === "engine_rec_trend_rising")).toBe(true);
  expect(withTrend.messages.some(m => m.key === "engine_rec_trend_overshoot_warn")).toBe(false);
});

test("recommendDose: preTrend rising_fast just above target → overshoot warning fires", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: 130,
    targetBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
    preTrend: "rising_fast",
  });
  expect(r.messages.some(m => m.key === "engine_rec_trend_rising_fast")).toBe(true);
  expect(r.messages.some(m => m.key === "engine_rec_trend_overshoot_warn")).toBe(true);
});

test("recommendDose: preTrend rising_fast far above target → no overshoot warning", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: 220,
    targetBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
    preTrend: "rising_fast",
  });
  expect(r.messages.some(m => m.key === "engine_rec_trend_rising_fast")).toBe(true);
  expect(r.messages.some(m => m.key === "engine_rec_trend_overshoot_warn")).toBe(false);
});

test("recommendDose: no preTrend → no trend message", () => {
  const r = recommendDose({
    carbs: 30,
    currentBG: 110,
    adaptiveICR: makeAdaptiveICR({ global: 15, sampleSize: 20 }),
  });
  expect(r.messages.some(m => m.key.startsWith("engine_rec_trend_"))).toBe(false);
});
