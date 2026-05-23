// Unit tests for calcEagerDose (lib/engine/eagerDose.ts).
//
// calcEagerDose is the pure carb+correction formula extracted from the
// engine page's eagerDoses useMemo. These tests pin the arithmetic so
// a mis-typed constant (e.g. CF=5 instead of CF=50) breaks immediately.

import { test, expect } from "@playwright/test";
import { calcEagerDose } from "@/lib/engine/eagerDose";

// ── 1. Carb-only dose (glucose at/below target → no correction) ──────────────

test("calcEagerDose: basic carb-only dose — 60 g carbs, ICR 10", () => {
  // 60 / 10 = 6.0 U; glucose 100 ≤ target 110 → no correction
  expect(calcEagerDose(60, 100, 10)).toBe(6.0);
});

test("calcEagerDose: carb-only dose rounds to 1 decimal", () => {
  // 50 / 12 = 4.1666… → rounds to 4.2
  expect(calcEagerDose(50, 90, 12)).toBe(4.2);
});

// ── 2. Correction threshold exactly at target — no correction added ──────────

test("calcEagerDose: glucose exactly at target (110) adds no correction", () => {
  // correction only when glucose > target, so at 110 it is 0
  expect(calcEagerDose(30, 110, 10)).toBe(3.0);
});

// ── 3. Above target — correction added ───────────────────────────────────────

test("calcEagerDose: glucose above target adds correction dose", () => {
  // carbDose = 40 / 10 = 4.0 U
  // corrDose = (160 - 110) / 50 = 50 / 50 = 1.0 U
  // total = 5.0 U
  expect(calcEagerDose(40, 160, 10)).toBe(5.0);
});

test("calcEagerDose: correction-only (zero carbs, glucose above target)", () => {
  // carbDose = 0 / 10 = 0
  // corrDose = (210 - 110) / 50 = 100 / 50 = 2.0 U
  expect(calcEagerDose(0, 210, 10)).toBe(2.0);
});

// ── 4. Zero / negative ICR → null ────────────────────────────────────────────

test("calcEagerDose: ICR of 0 returns null", () => {
  expect(calcEagerDose(60, 150, 0)).toBeNull();
});

test("calcEagerDose: negative ICR returns null", () => {
  expect(calcEagerDose(60, 150, -5)).toBeNull();
});

// ── 5. Negative glucose clamped — no negative correction ─────────────────────

test("calcEagerDose: negative glucose is clamped to 0 (no correction dose)", () => {
  // safeGlucose = max(0, -50) = 0; 0 ≤ 110 → no correction
  // carbDose = 60 / 10 = 6.0
  expect(calcEagerDose(60, -50, 10)).toBe(6.0);
});

test("calcEagerDose: negative glucose with zero carbs returns null (no input)", () => {
  // safeGlucose = 0; not > target; cGrams = 0 → no input → null
  expect(calcEagerDose(0, -100, 10)).toBeNull();
});

// ── 6. Combined carb + correction, rounding to 1 decimal ─────────────────────

test("calcEagerDose: combined carb+correction rounds correctly", () => {
  // carbDose = 45 / 12 = 3.75
  // corrDose = (180 - 110) / 50 = 70 / 50 = 1.4
  // total = 5.15 → rounds to 5.2
  expect(calcEagerDose(45, 180, 12)).toBe(5.2);
});

test("calcEagerDose: combined dose that rounds down", () => {
  // carbDose = 20 / 8 = 2.5
  // corrDose = (120 - 110) / 50 = 10 / 50 = 0.2
  // total = 2.7
  expect(calcEagerDose(20, 120, 8)).toBe(2.7);
});

// ── 7. Custom cf and target overrides ────────────────────────────────────────

test("calcEagerDose: custom CF (40) changes correction dose", () => {
  // carbDose = 0
  // corrDose = (150 - 110) / 40 = 40 / 40 = 1.0
  expect(calcEagerDose(0, 150, 10, 40)).toBe(1.0);
});

test("calcEagerDose: custom target (120) shifts correction threshold", () => {
  // glucose 115 is below custom target 120 → no correction
  // carbDose = 30 / 10 = 3.0
  expect(calcEagerDose(30, 115, 10, 50, 120)).toBe(3.0);
});

// ── 8. No meaningful input → null ────────────────────────────────────────────

test("calcEagerDose: zero carbs and glucose at target returns null", () => {
  expect(calcEagerDose(0, 110, 10)).toBeNull();
});

test("calcEagerDose: zero carbs and glucose below target returns null", () => {
  expect(calcEagerDose(0, 80, 10)).toBeNull();
});
