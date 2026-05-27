// Unit coverage for the meal-bolus mirror in `lib/meals.ts` → `saveMeal`.
//
// Task #471 added fire-and-forget mirroring of every meal bolus into
// `insulin_logs` so IOB, Engine safety hooks, and Insights ICR pairing all
// read from one source of truth. Because it is fire-and-forget, a future
// refactor could silently break the mirror (e.g. a changed `insertInsulinLog`
// signature) without any failing tests. This file guards the contract.
//
// What these tests pin:
//   1. `saveMeal` with `insulinUnits > 0` calls `insertInsulinLog` with
//      `insulin_type: "bolus"`, the correct `units`, the saved meal's
//      `related_entry_id`, and the meal-time-derived `at` timestamp.
//   2. `saveMeal` with `insulinUnits = 0` does NOT call `insertInsulinLog`.
//   3. `saveMeal` with `insulinUnits = null` does NOT call `insertInsulinLog`.
//   4. The `at` field is `mealTime` when present, otherwise `createdAt`.
//
// Mocking strategy:
//   • `_fake-supabase-meals.ts` (imported first) installs a lightweight fake
//     on `globalThis._supabase` before `lib/supabase.ts` evaluates its
//     singleton — the real Supabase client is never constructed.
//   • `saveMeal` accepts an optional `_deps` parameter that lets tests inject
//     a spy for `insertInsulinLog` without touching the production code path.
//   • The bolus mirror is fire-and-forget (`void async IIFE`) — after
//     `saveMeal` resolves, we drain the microtask + macrotask queues with a
//     zero-delay `setTimeout` so the spy has been awaited before we assert.

import {
  FAKE_MEAL_ID,
  FAKE_USER_ID,
  fakeClient,
  setStoredMealRow,
  resetStoredMealRow,
} from "./_fake-supabase-meals";

import { test, expect, beforeEach } from "@playwright/test";
import { saveMeal } from "@/lib/meals";
import type { InsulinLogInput, InsulinLog } from "@/lib/insulin";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Drain the micro + macrotask queue so fire-and-forget IIFEs complete. */
async function flushAsync() {
  await new Promise<void>((r) => setTimeout(r, 0));
}

function makeSpy() {
  const calls: InsulinLogInput[] = [];
  const fn = async (input: InsulinLogInput): Promise<InsulinLog> => {
    calls.push({ ...input });
    return {
      id: "log-spy-id",
      user_id: FAKE_USER_ID,
      created_at: new Date().toISOString(),
      insulin_type: input.insulin_type,
      insulin_name: input.insulin_name,
      units: input.units,
      cgm_glucose_at_log: input.cgm_glucose_at_log ?? null,
      notes: null,
      related_entry_id: input.related_entry_id ?? null,
    } as InsulinLog;
  };
  return { fn, calls };
}

const BASE_INPUT = {
  inputText: "Pasta mit Sauce",
  parsedJson: [],
  glucoseBefore: 110,
  glucoseAfter: null,
  carbsGrams: 60,
  proteinGrams: 8,
  fatGrams: 4,
  fiberGrams: 3,
  calories: 308,
  mealType: "BALANCED",
  evaluation: null,
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// Per-test reset
// ──────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStoredMealRow();
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 1: insulinUnits > 0 → mirror fires with correct payload
// ──────────────────────────────────────────────────────────────────────────────

test("saveMeal with insulinUnits > 0 calls insertInsulinLog with correct fields", async () => {
  const spy = makeSpy();

  setStoredMealRow({ id: FAKE_MEAL_ID, insulin_units: 4 });

  await saveMeal(
    { ...BASE_INPUT, insulinUnits: 4 },
    { _supabase: fakeClient, _insertInsulinLog: spy.fn },
  );
  await flushAsync();

  expect(spy.calls).toHaveLength(1);

  const call = spy.calls[0];
  expect(call.insulin_type).toBe("bolus");
  expect(call.units).toBe(4);
  expect(call.related_entry_id).toBe(FAKE_MEAL_ID);
  expect(call.insulin_name).toBe("Mahlzeit-Bolus");
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: insulinUnits = 0 → mirror must NOT fire
// ──────────────────────────────────────────────────────────────────────────────

test("saveMeal with insulinUnits = 0 does NOT call insertInsulinLog", async () => {
  const spy = makeSpy();

  setStoredMealRow({ id: FAKE_MEAL_ID, insulin_units: 0 });

  await saveMeal(
    { ...BASE_INPUT, insulinUnits: 0 },
    { _supabase: fakeClient, _insertInsulinLog: spy.fn },
  );
  await flushAsync();

  expect(spy.calls).toHaveLength(0);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 3: insulinUnits = null → mirror must NOT fire
// ──────────────────────────────────────────────────────────────────────────────

test("saveMeal with insulinUnits = null does NOT call insertInsulinLog", async () => {
  const spy = makeSpy();

  setStoredMealRow({ id: FAKE_MEAL_ID, insulin_units: null });

  await saveMeal(
    { ...BASE_INPUT, insulinUnits: null },
    { _supabase: fakeClient, _insertInsulinLog: spy.fn },
  );
  await flushAsync();

  expect(spy.calls).toHaveLength(0);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 4: `at` uses mealTime when present
// ──────────────────────────────────────────────────────────────────────────────

test("saveMeal passes mealTime as `at` when provided", async () => {
  const spy = makeSpy();
  const mealTime = "2026-05-22T12:30:00.000Z";

  await saveMeal(
    { ...BASE_INPUT, insulinUnits: 3, mealTime },
    { _supabase: fakeClient, _insertInsulinLog: spy.fn },
  );
  await flushAsync();

  expect(spy.calls).toHaveLength(1);
  expect(spy.calls[0].at).toBe(mealTime);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 5: falls back to createdAt when mealTime is absent
// ──────────────────────────────────────────────────────────────────────────────

test("saveMeal passes createdAt as `at` when mealTime is absent", async () => {
  const spy = makeSpy();
  const createdAt = "2026-05-22T08:00:00.000Z";

  await saveMeal(
    { ...BASE_INPUT, insulinUnits: 2, createdAt },
    { _supabase: fakeClient, _insertInsulinLog: spy.fn },
  );
  await flushAsync();

  expect(spy.calls).toHaveLength(1);
  expect(spy.calls[0].at).toBe(createdAt);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 6: glucoseBefore is forwarded as cgm_glucose_at_log
// ──────────────────────────────────────────────────────────────────────────────

test("saveMeal forwards glucoseBefore as cgm_glucose_at_log in the mirror call", async () => {
  const spy = makeSpy();

  await saveMeal(
    { ...BASE_INPUT, insulinUnits: 5, glucoseBefore: 142 },
    { _supabase: fakeClient, _insertInsulinLog: spy.fn },
  );
  await flushAsync();

  expect(spy.calls).toHaveLength(1);
  expect(spy.calls[0].cgm_glucose_at_log).toBe(142);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 7: mirror failure is swallowed — saveMeal still resolves
// ──────────────────────────────────────────────────────────────────────────────

test("a throwing insertInsulinLog does not cause saveMeal to reject", async () => {
  const throwingFn = async (_input: InsulinLogInput): Promise<InsulinLog> => {
    throw new Error("Supabase connection refused");
  };

  const meal = await saveMeal(
    { ...BASE_INPUT, insulinUnits: 6 },
    { _supabase: fakeClient, _insertInsulinLog: throwingFn },
  );
  await flushAsync();

  expect(meal.id).toBe(FAKE_MEAL_ID);
});
