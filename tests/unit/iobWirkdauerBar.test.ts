// Regression guard for the IOBCard Wirkdauer bar and basal CircleGauge (Task #717).
//
// ## Coverage strategy
//
// Three layers of protection, each targeting a distinct failure mode:
//
// 1. **Source inspection** (no mount needed):
//    Reads `components/IOBCard.tsx` and asserts that the basal CircleGauge
//    call passes `fraction={1}`, not `fraction={basalFraction}`. This is the
//    cheapest guard against the regression described in Task #712 Fix Log.
//    A search-and-replace or copy-paste error that reverts to a decaying
//    fraction would be caught immediately.
//
// 2. **Library invariants** (lib/iob.ts pure functions):
//    Tests the two boolean conditions that the Wirkdauer bar branches on:
//      • `cleared = iob < 0.05`  — driven by calcTotalIOB
//      • `clearsInMin > 0`       — also driven by calcTotalIOB + elapsed logic
//    We do NOT re-implement the component's inline formulas here; we only
//    verify that the LIBRARY functions produce the right cleared/active state
//    for the scenarios the component is expected to encounter. Any drift
//    between the library result and the component's inline calculation would
//    be caught by the E2E layer (see iob-wirkdauer-bar.spec.ts).
//
// 3. **calcBasalRemaining contract** (cross-check):
//    Locks in the linear-decay model that drives the basal expanded detail
//    panel's unit display. Already has its own suite in iobCard.test.ts;
//    repeated here only for the fraction=1 cross-check assertion.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  buildDoses,
  calcTotalIOB,
  getDIAMinutes,
  calcBasalRemaining,
} from "@/lib/iob";
import type { MealLike } from "@/lib/iob";

// ── Shared constants ─────────────────────────────────────────────────────────

const RAPID_DIA_MIN = getDIAMinutes("rapid"); // 180
const BASAL_WINDOW_MIN = 24 * 60;             // 1440

// IOBCard treats iob < 0.05 as "cleared" — drives both the ring display and
// the Wirkdauer bar visibility guard `!cleared && clearsInMin > 0`.
const CLEARED_THRESHOLD = 0.05;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function makeMeal(overrides: Partial<MealLike> & { id: string }): MealLike {
  return {
    insulin_units: 4,
    meal_time: isoMinutesAgo(30),
    created_at: isoMinutesAgo(30),
    ...overrides,
  };
}

// ── Section 1: Basal CircleGauge — always fraction={1} ───────────────────────
//
// Task #712 fixed the basal ring from a decaying fill (fraction={basalFraction})
// to an always-full ring (fraction={1}). The ring is a presence indicator, not
// a depletion meter. Task #717 cements this with an automated guard.
//
// We read the source file directly so the test fails the moment someone
// reverts the prop value — no component mount required, zero false-confidence.

test("basal CircleGauge prop: component source passes fraction={1}, not fraction={basalFraction}", () => {
  const srcPath = path.resolve("components/IOBCard.tsx");
  const src = fs.readFileSync(srcPath, "utf-8");

  // The basal view CircleGauge must use the literal {1}.
  // We locate the prop on the line that follows the basal gauge comment.
  // The comment "Basal gauge — always full ring" is the anchor; the next
  // CircleGauge prop block must contain `fraction={1}`.
  const basalGaugeSection = src.slice(
    src.indexOf("Basal gauge — always full ring"),
    src.indexOf("Basal info"),
  );

  expect(basalGaugeSection).toContain("fraction={1}");
  expect(basalGaugeSection).not.toContain("fraction={basalFraction}");
});

test("basal CircleGauge prop: component source does NOT pass fraction={basalFraction} to the collapsed ring", () => {
  const srcPath = path.resolve("components/IOBCard.tsx");
  const src = fs.readFileSync(srcPath, "utf-8");

  // basalFraction is legitimately used for the expanded COVERAGE BAR.
  // Count occurrences: there must be no occurrence of `fraction={basalFraction}`.
  // (basalFraction itself will still appear — but only in bar calc contexts.)
  const fractionBasalCount = (src.match(/fraction=\{basalFraction\}/g) ?? []).length;
  expect(fractionBasalCount).toBe(0);
});

// ── Section 2: cleared threshold — IOB library invariants ────────────────────
//
// The Wirkdauer bar's visibility gate is `!cleared && clearsInMin > 0`.
// `cleared` is derived from calcTotalIOB in the component:
//   const cleared = iob < 0.05;
//
// We verify the library returns the correct iob value for both states so
// the component sees the right boolean. We do NOT replicate the component's
// inline `clearsInMin` or `bolusFraction` formulas — those are tested
// end-to-end via iob-wirkdauer-bar.spec.ts.

test("cleared=true: calcTotalIOB < threshold when no doses are present", () => {
  const iob = calcTotalIOB([], "rapid");
  expect(iob).toBeLessThan(CLEARED_THRESHOLD);
});

test("cleared=true: calcTotalIOB < threshold when all doses have fully elapsed", () => {
  const doses = buildDoses([], [
    makeMeal({ id: "m1", insulin_units: 4, meal_time: isoMinutesAgo(RAPID_DIA_MIN + 60) }),
  ]);
  const iob = calcTotalIOB(doses, "rapid");
  expect(iob).toBeLessThan(CLEARED_THRESHOLD);
});

test("cleared=true: calcTotalIOB < threshold at exact DIA boundary (edge-case from task #717)", () => {
  // At elapsed === diaMin the quadratic decay produces ~0 IOB.
  const doses = buildDoses([], [
    makeMeal({ id: "m1", insulin_units: 4, meal_time: isoMinutesAgo(RAPID_DIA_MIN) }),
  ]);
  const iob = calcTotalIOB(doses, "rapid");
  expect(iob).toBeLessThan(CLEARED_THRESHOLD);
});

test("cleared=false: calcTotalIOB >= threshold with an active recent dose", () => {
  const doses = buildDoses([], [
    makeMeal({ id: "m1", insulin_units: 4, meal_time: isoMinutesAgo(30) }),
  ]);
  const iob = calcTotalIOB(doses, "rapid");
  expect(iob).toBeGreaterThanOrEqual(CLEARED_THRESHOLD);
});

test("cleared=false: calcTotalIOB >= threshold with dose 30 min before DIA (non-trivial decay check)", () => {
  // At elapsed = DIA − 30 for rapid insulin, the quadratic decay still leaves
  // residual ≈ units × (30/180)² = 10 × 0.028 ≈ 0.28 IE — above the 0.05 threshold.
  const doses = buildDoses([], [
    makeMeal({ id: "m1", insulin_units: 10, meal_time: isoMinutesAgo(RAPID_DIA_MIN - 30) }),
  ]);
  const iob = calcTotalIOB(doses, "rapid");
  expect(iob).toBeGreaterThanOrEqual(CLEARED_THRESHOLD);
});

test("cleared=false: calcTotalIOB >= threshold with multiple active doses", () => {
  const doses = buildDoses([], [
    makeMeal({ id: "m1", insulin_units: 2, meal_time: isoMinutesAgo(20) }),
    makeMeal({ id: "m2", insulin_units: 3, meal_time: isoMinutesAgo(90) }),
  ]);
  const iob = calcTotalIOB(doses, "rapid");
  expect(iob).toBeGreaterThanOrEqual(CLEARED_THRESHOLD);
});

// ── Section 3: calcBasalRemaining cross-check ─────────────────────────────────
//
// The basal expanded detail panel shows an approximate remaining dose derived
// from calcBasalRemaining(units, elapsedMin, windowMin). Because the collapsed
// ring is now always fraction={1}, the ONLY place basalFraction is used is the
// expanded coverage bar — we lock in the underlying math here.

test("calcBasalRemaining: fraction model — remaining equals units × (1 − elapsed/window)", () => {
  const units = 10;
  // Sample at 0 h, 6 h, 12 h, 18 h, 24 h
  const checkpoints = [0, 360, 720, 1080, 1440];
  for (const elapsed of checkpoints) {
    const expectedFraction = Math.max(0, 1 - elapsed / BASAL_WINDOW_MIN);
    const actual = calcBasalRemaining(units, elapsed, BASAL_WINDOW_MIN);
    expect(actual).toBeCloseTo(units * expectedFraction, 5);
  }
});

test("calcBasalRemaining: returns full dose at elapsed=0 (freshly injected)", () => {
  expect(calcBasalRemaining(15, 0, BASAL_WINDOW_MIN)).toBe(15);
});

test("calcBasalRemaining: returns 0 at elapsed=window (fully expired)", () => {
  expect(calcBasalRemaining(15, BASAL_WINDOW_MIN, BASAL_WINDOW_MIN)).toBe(0);
});

test("calcBasalRemaining: clamped to 0 when elapsed > window (no negative residual)", () => {
  const remaining = calcBasalRemaining(15, BASAL_WINDOW_MIN + 120, BASAL_WINDOW_MIN);
  expect(remaining).toBe(0);
  expect(remaining).toBeGreaterThanOrEqual(0);
});
