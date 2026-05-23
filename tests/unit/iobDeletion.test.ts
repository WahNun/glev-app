// Unit coverage for the IOB dose-list update when entries are deleted.
//
// The IOBCard receives `insulin` and `meals` as props and derives doses
// via `buildDoses`. Deleting a bolus entry removes it from those arrays,
// which must be reflected in the resulting dose count and total IOB.
//
// These tests pin the contract so a refactor can't accidentally break
// the "delete → IOB drops" invariant without a failing test.

import { test, expect } from "@playwright/test";
import { buildDoses, calcTotalIOB } from "@/lib/iob";
import type { InsulinLike, MealLike } from "@/lib/iob";

const NOW = new Date("2026-05-23T12:00:00Z").getTime();
// 30 minutes ago — well within any DIA window
const RECENT = new Date(NOW - 30 * 60_000).toISOString();

// ── buildDoses: insulin log deletion ────────────────────────────────

test("buildDoses: removing a bolus log reduces dose count by 1", () => {
  const allLogs: InsulinLike[] = [
    { id: "b1", insulin_type: "bolus", units: 3, created_at: RECENT },
    { id: "b2", insulin_type: "bolus", units: 2, created_at: RECENT },
  ];

  const before = buildDoses(allLogs);
  expect(before).toHaveLength(2);

  // Simulate deletion of b1
  const afterDeletion = buildDoses(allLogs.filter(l => l.id !== "b1"));
  expect(afterDeletion).toHaveLength(1);
  expect(afterDeletion[0].units).toBe(2);
});

test("buildDoses: deleting the only bolus log yields an empty dose list", () => {
  const logs: InsulinLike[] = [
    { id: "solo", insulin_type: "bolus", units: 4, created_at: RECENT },
  ];

  const after = buildDoses(logs.filter(l => l.id !== "solo"));
  expect(after).toHaveLength(0);
});

// ── buildDoses: meal entry deletion ─────────────────────────────────

test("buildDoses: removing a meal entry reduces dose count by 1", () => {
  const meals: MealLike[] = [
    { id: "m1", insulin_units: 3, created_at: RECENT },
    { id: "m2", insulin_units: 2, created_at: RECENT },
  ];

  const before = buildDoses([], meals);
  expect(before).toHaveLength(2);

  const after = buildDoses([], meals.filter(m => m.id !== "m1"));
  expect(after).toHaveLength(1);
  expect(after[0].units).toBe(2);
});

test("buildDoses: deleting the only meal with insulin_units yields an empty dose list", () => {
  const meals: MealLike[] = [
    { id: "m1", insulin_units: 5, created_at: RECENT },
  ];

  const after = buildDoses([], meals.filter(m => m.id !== "m1"));
  expect(after).toHaveLength(0);
});

// ── calcTotalIOB: IOB drops after deletion ───────────────────────────

test("calcTotalIOB drops to 0 when the only bolus log is deleted", () => {
  const logs: InsulinLike[] = [
    { id: "b1", insulin_type: "bolus", units: 4, created_at: RECENT },
  ];

  const before = calcTotalIOB(buildDoses(logs), "rapid", NOW, 180);
  expect(before).toBeGreaterThan(0);

  const after = calcTotalIOB(buildDoses([]), "rapid", NOW, 180);
  expect(after).toBe(0);
});

test("calcTotalIOB is lower after deleting one of two bolus logs", () => {
  const logs: InsulinLike[] = [
    { id: "b1", insulin_type: "bolus", units: 3, created_at: RECENT },
    { id: "b2", insulin_type: "bolus", units: 2, created_at: RECENT },
  ];

  const before = calcTotalIOB(buildDoses(logs), "rapid", NOW, 180);
  const after  = calcTotalIOB(buildDoses(logs.filter(l => l.id !== "b1")), "rapid", NOW, 180);
  expect(after).toBeLessThan(before);
});

test("calcTotalIOB drops to 0 when the only meal bolus is deleted", () => {
  const meals: MealLike[] = [
    { id: "m1", insulin_units: 6, created_at: RECENT },
  ];

  const before = calcTotalIOB(buildDoses([], meals), "rapid", NOW, 180);
  expect(before).toBeGreaterThan(0);

  const after = calcTotalIOB(buildDoses([], []), "rapid", NOW, 180);
  expect(after).toBe(0);
});
