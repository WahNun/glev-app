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
import { applyIOBCorrection, iobCorrectionRoundedToZero } from "@/lib/iob";

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

// ── 5. Near-zero boundary: rounding at the 0.05 threshold ────────────────────
// applyIOBCorrection rounds to 1 decimal place via Math.round(x * 10) / 10.
// A recommendation of 0.05 with no IOB → 0.05 * 10 = 0.5 → rounds to 1 → 0.1.
// A recommendation of 0.04 with no IOB → 0.04 * 10 = 0.4 → rounds to 0 → 0.0.
// These tests ensure tiny but real recommendations are not silently dropped.

test("applyIOBCorrection: recommendation=0.05, iob=0 rounds up to 0.1 (not silently zeroed)", () => {
  expect(applyIOBCorrection(0.05, 0)).toBe(0.1);
});

test("applyIOBCorrection: recommendation=0.04, iob=0 rounds down to 0 (correctly silent)", () => {
  expect(applyIOBCorrection(0.04, 0)).toBe(0);
});

test("applyIOBCorrection: recommendation=0.09, iob=0.05 → result=0.04 → rounds to 0.0 (rounding, not clamp)", () => {
  // 0.09 - 0.05 = 0.04 → Math.round(0.4) = 0 → 0.0
  // This should be 0 due to rounding, *not* because of the Math.max(0,…) clamp.
  expect(applyIOBCorrection(0.09, 0.05)).toBe(0);
});

test("applyIOBCorrection: recommendation=0.15, iob=0.05 → result=0.1 (clean case near threshold)", () => {
  expect(applyIOBCorrection(0.15, 0.05)).toBe(0.1);
});

// ── 6. iobCorrectionRoundedToZero: detects silently-dropped non-zero doses ───
// The helper returns true only when the pre-rounding result is positive but
// rounds to 0 (i.e. 0 < recommendation − iob < 0.05).  It returns false when:
//   • the Math.max(0,…) clamp caused the zero (iob ≥ recommendation), or
//   • the corrected dose is a displayable non-zero value.

test("iobCorrectionRoundedToZero: true when recommendation=0.04, iob=0 (tiny dose, no iob)", () => {
  // 0.04 − 0 = 0.04 → rounds to 0 → pre-rounding value was positive
  expect(iobCorrectionRoundedToZero(0.04, 0)).toBe(true);
});

test("iobCorrectionRoundedToZero: true when remainder is 0.04 (recommendation > iob by tiny margin)", () => {
  // 0.09 − 0.05 = 0.04 → rounds to 0
  expect(iobCorrectionRoundedToZero(0.09, 0.05)).toBe(true);
});

test("iobCorrectionRoundedToZero: false when iob fully covers recommendation (Math.max clamp case)", () => {
  // pre-rounding value is negative → clamped to 0 via Math.max, not rounding
  expect(iobCorrectionRoundedToZero(2, 4)).toBe(false);
});

test("iobCorrectionRoundedToZero: false when iob equals recommendation exactly", () => {
  expect(iobCorrectionRoundedToZero(3, 3)).toBe(false);
});

test("iobCorrectionRoundedToZero: false when corrected dose rounds to a displayable value", () => {
  // 0.5 − 0 = 0.5 → rounds to 0.5 (non-zero)
  expect(iobCorrectionRoundedToZero(0.5, 0)).toBe(false);
});

test("iobCorrectionRoundedToZero: false when recommendation=0.05, iob=0 (rounds up to 0.1, not zero)", () => {
  expect(iobCorrectionRoundedToZero(0.05, 0)).toBe(false);
});

test("iobCorrectionRoundedToZero: false for recommendation=0, iob=0 (both zero)", () => {
  expect(iobCorrectionRoundedToZero(0, 0)).toBe(false);
});
