// Unit coverage for `lib/engine/pairing.ts` — bolus↔meal pairing
// for adaptive ICR / pattern detection.
//
// Locks in:
//   1. Explicit `related_entry_id` always wins over a closer time-window
//      candidate (user intent overrides proximity).
//   2. Time-window heuristic respects the ±30 min boundary; matches
//      outside the window are rejected.
//   3. Greedy global ranking — closest |Δt| pair wins, then each meal
//      and each bolus participate at most once.
//   4. Empty / non-bolus inputs return an empty array (or null for
//      pairBolusToMeal).

import { test, expect } from "@playwright/test";

import { pairBolusToMeal, pairBolusesToMeals, BOLUS_MEAL_WINDOW_MS } from "@/lib/engine/pairing";
import { makeMeal, makeInsulinLog, FIXTURE_BASE_MS } from "../support/engineFixtures";

function isoAt(offsetMin: number): string {
  return new Date(FIXTURE_BASE_MS + offsetMin * 60_000).toISOString();
}

// ── pairBolusToMeal (single) ────────────────────────────────────────

test("pairBolusToMeal: returns null for a basal log", () => {
  const basal = makeInsulinLog({ insulin_type: "basal" });
  const meal = makeMeal({ id: "m1" });
  expect(pairBolusToMeal(basal, [meal])).toBeNull();
});

test("pairBolusToMeal: explicit related_entry_id matches by id (source=explicit, deltaMs=0)", () => {
  const meal = makeMeal({ id: "m1", meal_time: isoAt(60), created_at: isoAt(60) });
  const bolus = makeInsulinLog({ id: "b1", related_entry_id: "m1", created_at: isoAt(0) });
  const pair = pairBolusToMeal(bolus, [meal]);
  expect(pair).not.toBeNull();
  expect(pair!.source).toBe("explicit");
  expect(pair!.meal.id).toBe("m1");
  expect(pair!.deltaMs).toBe(0);
});

test("pairBolusToMeal: time-window picks the closest meal within ±30 min", () => {
  const near = makeMeal({ id: "near", meal_time: isoAt(10), created_at: isoAt(10) });   // +10 min
  const far  = makeMeal({ id: "far",  meal_time: isoAt(25), created_at: isoAt(25) });   // +25 min
  const bolus = makeInsulinLog({ id: "b1", related_entry_id: null, created_at: isoAt(0) });
  const pair = pairBolusToMeal(bolus, [far, near]);
  expect(pair).not.toBeNull();
  expect(pair!.source).toBe("time-window");
  expect(pair!.meal.id).toBe("near");
});

test("pairBolusToMeal: meals outside ±30 min are rejected", () => {
  const meal = makeMeal({ id: "m1", meal_time: isoAt(45), created_at: isoAt(45) });
  const bolus = makeInsulinLog({ id: "b1", related_entry_id: null, created_at: isoAt(0) });
  expect(pairBolusToMeal(bolus, [meal])).toBeNull();
});

test("pairBolusToMeal: explicit link wins even if a closer time-window candidate exists", () => {
  const closeMeal = makeMeal({ id: "close", meal_time: isoAt(2),  created_at: isoAt(2) });
  const taggedFar = makeMeal({ id: "tag",   meal_time: isoAt(20), created_at: isoAt(20) });
  const bolus = makeInsulinLog({ id: "b1", related_entry_id: "tag", created_at: isoAt(0) });
  const pair = pairBolusToMeal(bolus, [closeMeal, taggedFar]);
  expect(pair!.source).toBe("explicit");
  expect(pair!.meal.id).toBe("tag");
});

// ── pairBolusesToMeals (batch) ──────────────────────────────────────

test("pairBolusesToMeals: empty inputs return an empty array", () => {
  expect(pairBolusesToMeals([], [])).toEqual([]);
  expect(pairBolusesToMeals([makeInsulinLog({ insulin_type: "bolus" })], [])).toEqual([]);
  expect(pairBolusesToMeals([], [makeMeal({ id: "m1" })])).toEqual([]);
});

test("pairBolusesToMeals: explicit pairs win, then time-window pairs by closest |Δt|", () => {
  // Two bolus logs, three meals.
  // - b1 explicitly tagged to m_tag (far apart in time)
  // - b2 has no tag; both m_near (Δ=5 min) and m_tag (Δ=2 min) are
  //   in window, but m_tag is already consumed by b1 → b2 pairs to m_near.
  const m_near = makeMeal({ id: "m_near", meal_time: isoAt(5),  created_at: isoAt(5) });
  const m_tag  = makeMeal({ id: "m_tag",  meal_time: isoAt(28), created_at: isoAt(28) });
  const m_off  = makeMeal({ id: "m_off",  meal_time: isoAt(120), created_at: isoAt(120) });

  const b1 = makeInsulinLog({ id: "b1", related_entry_id: "m_tag", created_at: isoAt(30) });
  const b2 = makeInsulinLog({ id: "b2", related_entry_id: null,    created_at: isoAt(0) });

  const pairs = pairBolusesToMeals([b1, b2], [m_near, m_tag, m_off]);
  expect(pairs).toHaveLength(2);

  const byBolus = new Map(pairs.map(p => [p.bolus.id, p]));
  expect(byBolus.get("b1")!.meal.id).toBe("m_tag");
  expect(byBolus.get("b1")!.source).toBe("explicit");
  expect(byBolus.get("b2")!.meal.id).toBe("m_near");
  expect(byBolus.get("b2")!.source).toBe("time-window");
});

test("pairBolusesToMeals: greedy resolution — globally closest pair wins when two boluses compete for one meal", () => {
  // Both b_close and b_far want m1; b_close is at Δ=1 min, b_far at Δ=20 min.
  // Closest wins, b_far falls through to m2 (Δ=15 min from b_far).
  const m1 = makeMeal({ id: "m1", meal_time: isoAt(0),  created_at: isoAt(0) });
  const m2 = makeMeal({ id: "m2", meal_time: isoAt(35), created_at: isoAt(35) });

  const b_close = makeInsulinLog({ id: "b_close", related_entry_id: null, created_at: isoAt(1) });
  const b_far   = makeInsulinLog({ id: "b_far",   related_entry_id: null, created_at: isoAt(20) });

  const pairs = pairBolusesToMeals([b_close, b_far], [m1, m2]);
  const byBolus = new Map(pairs.map(p => [p.bolus.id, p]));
  expect(byBolus.get("b_close")!.meal.id).toBe("m1");
  expect(byBolus.get("b_far")!.meal.id).toBe("m2");
});

test("pairBolusesToMeals: each meal participates at most once", () => {
  const m1 = makeMeal({ id: "m1", meal_time: isoAt(0), created_at: isoAt(0) });
  const b1 = makeInsulinLog({ id: "b1", related_entry_id: null, created_at: isoAt(1) });
  const b2 = makeInsulinLog({ id: "b2", related_entry_id: null, created_at: isoAt(2) });

  const pairs = pairBolusesToMeals([b1, b2], [m1]);
  expect(pairs).toHaveLength(1);
  expect(pairs[0].bolus.id).toBe("b1"); // closest wins
});

test("pairBolusesToMeals: basal logs are ignored", () => {
  const meal = makeMeal({ id: "m1", meal_time: isoAt(0), created_at: isoAt(0) });
  const basal = makeInsulinLog({ id: "ba1", insulin_type: "basal", created_at: isoAt(0) });
  expect(pairBolusesToMeals([basal], [meal])).toEqual([]);
});

test("BOLUS_MEAL_WINDOW_MS is exactly 30 minutes", () => {
  expect(BOLUS_MEAL_WINDOW_MS).toBe(30 * 60 * 1000);
});
