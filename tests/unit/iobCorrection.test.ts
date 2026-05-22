// Unit tests for applyIOBCorrection (lib/iob.ts).
//
// applyIOBCorrection(recommendation, iob) subtracts active insulin-on-board
// from a dose recommendation to avoid stacking.
//
// Invariants under test:
//   1. Normal case: result = recommendation - iob (both positive, iob < recommendation).
//   2. Clamp: result is never negative — when iob >= recommendation the output is 0.
//   3. Rounding: result is rounded to exactly 1 decimal place.
//   4. Identity: iob = 0 leaves the recommendation unchanged.

import { test, expect } from "@playwright/test";
import { applyIOBCorrection } from "@/lib/iob";

// ── 1. Normal correction: recommendation - iob ───────────────────────────────

test("applyIOBCorrection: subtracts iob from recommendation (basic case)", () => {
  expect(applyIOBCorrection(5, 2)).toBe(3);
});

test("applyIOBCorrection: subtracts a fractional iob correctly", () => {
  expect(applyIOBCorrection(4, 1.5)).toBe(2.5);
});

test("applyIOBCorrection: small positive iob reduces recommendation by that amount", () => {
  expect(applyIOBCorrection(3.0, 0.5)).toBe(2.5);
});

// ── 2. Clamp: result is never negative ───────────────────────────────────────

test("applyIOBCorrection: returns 0 when iob equals recommendation (exact)", () => {
  expect(applyIOBCorrection(4, 4)).toBe(0);
});

test("applyIOBCorrection: returns 0 when iob exceeds recommendation", () => {
  expect(applyIOBCorrection(3, 5)).toBe(0);
});

test("applyIOBCorrection: returns 0 when iob greatly exceeds recommendation", () => {
  expect(applyIOBCorrection(1, 10)).toBe(0);
});

test("applyIOBCorrection: returns 0 for recommendation=0 with any positive iob", () => {
  expect(applyIOBCorrection(0, 2)).toBe(0);
});

// ── 3. Rounding to 1 decimal place ───────────────────────────────────────────

test("applyIOBCorrection: rounds result to 1 decimal place (rounds up)", () => {
  // 4.0 - 1.34 = 2.66 → rounds to 2.7
  expect(applyIOBCorrection(4.0, 1.34)).toBe(2.7);
});

test("applyIOBCorrection: rounds result to 1 decimal place (rounds down)", () => {
  // 4.0 - 1.32 = 2.68 → rounds to 2.7
  // 5.0 - 1.72 = 3.28 → rounds to 3.3
  expect(applyIOBCorrection(5.0, 1.72)).toBe(3.3);
});

test("applyIOBCorrection: result with a whole-number difference has no trailing decimal noise", () => {
  expect(applyIOBCorrection(6, 2)).toBe(4);
});

// ── 4. iob = 0 → recommendation unchanged ────────────────────────────────────

test("applyIOBCorrection: iob=0 leaves recommendation unchanged (integer)", () => {
  expect(applyIOBCorrection(5, 0)).toBe(5);
});

test("applyIOBCorrection: iob=0 leaves recommendation unchanged (fractional)", () => {
  expect(applyIOBCorrection(3.5, 0)).toBe(3.5);
});

test("applyIOBCorrection: iob=0 with recommendation=0 returns 0", () => {
  expect(applyIOBCorrection(0, 0)).toBe(0);
});
