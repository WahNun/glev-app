// Unit coverage for `lib/engine/lifecycle.ts` — the unified meal
// evaluator introduced by Task #15 (and now pinned by Task #41 +
// refactored under Task #191 to emit structured `AdjustmentMessage[]`
// keys instead of hard-coded EN strings).
//
// What this guards:
//   1. The ±30 min validation window guard. A bg_2h or bg_1h reading
//      whose `*_at` timestamp lies more than 30 min away from the
//      expected capture time (meal_time + 120min / + 60min) must NOT
//      be used to classify the meal — the row stays provisional with
//      `outcome: null` and the messages array carries the
//      `engine_lc_outside_window` key plus the actual signed gap so
//      the entries page can explain why.
//   2. The Pending state for fresh meals (age < 60min, no readings).
//   3. The numeric speed1 / speed2 keys (`engine_speed1_rose`,
//      `engine_speed2_fell`, …) and their `params.speed` strings.
//
// Why this is a Playwright spec (no browser):
//   The project's only test runner is Playwright (`npm test` →
//   `playwright test`), and the widened `testDir: "./tests"` in
//   `playwright.config.ts` automatically picks up files under
//   `tests/unit/*.test.ts` alongside the existing e2e specs.

import { test, expect } from "@playwright/test";

import { lifecycleFor } from "@/lib/engine/lifecycle";
import type { AdjustmentMessage } from "@/lib/engine/adjustment";
import type { Meal } from "@/lib/meals";
import type { InsulinSettings } from "@/lib/userSettings";

/* ──────────────────────────────────────────────────────────────────
   Fixture builders.
   ────────────────────────────────────────────────────────────────── */

const MEAL_TIME = "2026-04-30T08:00:00Z";
const MEAL_MS = Date.parse(MEAL_TIME);
const NOW = new Date(MEAL_MS + 3 * 60 * 60_000);

const SETTINGS: InsulinSettings = { icr: 15, cf: 50, targetBg: 110 };

function atOffset(minAfterMeal: number): string {
  return new Date(MEAL_MS + minAfterMeal * 60_000).toISOString();
}

function makeMeal(overrides: Partial<Meal>): Meal {
  return {
    id: "m1",
    user_id: "u1",
    input_text: "",
    parsed_json: [],
    glucose_before: null,
    glucose_after: null,
    bg_1h: null,
    bg_1h_at: null,
    bg_2h: null,
    bg_2h_at: null,
    glucose_30min: null,
    glucose_30min_at: null,
    glucose_1h: null,
    glucose_1h_at: null,
    glucose_90min: null,
    glucose_90min_at: null,
    glucose_2h: null,
    glucose_2h_at: null,
    glucose_3h: null,
    glucose_3h_at: null,
    outcome_state: null,
    min_bg_180: null, max_bg_180: null, time_to_peak_min: null,
    auc_180: null, had_hypo_window: null, min_bg_60_180: null,
    meal_time: MEAL_TIME,
    carbs_grams: 60,
    protein_grams: 10,
    fat_grams: 5,
    fiber_grams: 3,
    calories: null,
    insulin_units: 4,
    meal_type: "BALANCED",
    evaluation: null,
    related_meal_id: null,
    created_at: MEAL_TIME,
    ...overrides,
  };
}

function hasKey(messages: AdjustmentMessage[], key: string): boolean {
  return messages.some(m => m.key === key);
}

function findKey(messages: AdjustmentMessage[], key: string): AdjustmentMessage | undefined {
  return messages.find(m => m.key === key);
}

/* ──────────────────────────────────────────────────────────────────
   2-hour reading inside the ±30 min window → state="final".
   ────────────────────────────────────────────────────────────────── */

test("lifecycleFor: bg_2h captured exactly at +120min → state='final' with non-null outcome", () => {
  const meal = makeMeal({
    glucose_before: 100,
    bg_2h: 110,
    bg_2h_at: atOffset(120),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("final");
  expect(r.outcome).toBe("GOOD");
  expect(r.outOfWindow).toBe(false);
  expect(r.delta2).toBe(10);
  expect(hasKey(r.messages, "engine_eval_good")).toBe(true);
});

test("lifecycleFor: bg_2h captured 25min late → still inside window → state='final'", () => {
  const meal = makeMeal({
    glucose_before: 100,
    bg_2h: 170,
    bg_2h_at: atOffset(120 + 25),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("final");
  expect(r.outcome).toBe("SPIKE");
  expect(r.outOfWindow).toBe(false);
  expect(hasKey(r.messages, "engine_eval_spike")).toBe(true);
});

/* ──────────────────────────────────────────────────────────────────
   2-hour reading outside ±30 min window → outcome dropped.
   ────────────────────────────────────────────────────────────────── */

test("lifecycleFor: bg_2h captured 47min late → outcome=null + engine_lc_outside_window key with signed gap", () => {
  const meal = makeMeal({
    glucose_before: 100,
    bg_2h: 170,
    bg_2h_at: atOffset(120 + 47),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("provisional");
  expect(r.outcome).toBeNull();
  expect(r.outOfWindow).toBe(true);
  const m = findKey(r.messages, "engine_lc_outside_window");
  expect(m).toBeDefined();
  expect(m!.params!.gap).toBe("+47");
  // No evaluation messages should leak through when the reading was dropped.
  expect(hasKey(r.messages, "engine_eval_spike")).toBe(false);
  expect(r.delta2).toBe(70);
});

test("lifecycleFor: bg_2h captured 45min EARLY → also outside window", () => {
  const meal = makeMeal({
    glucose_before: 100,
    bg_2h: 110,
    bg_2h_at: atOffset(120 - 45),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("provisional");
  expect(r.outcome).toBeNull();
  expect(r.outOfWindow).toBe(true);
  const m = findKey(r.messages, "engine_lc_outside_window");
  expect(m).toBeDefined();
  expect(m!.params!.gap).toBe("-45");
});

/* ──────────────────────────────────────────────────────────────────
   1-hour reading: same window guard, plus the "1-hour check" branch.
   ────────────────────────────────────────────────────────────────── */

test("lifecycleFor: bg_1h captured exactly at +60min → state='provisional' with outcome", () => {
  const meal = makeMeal({
    glucose_before: 100,
    bg_1h: 115,
    bg_1h_at: atOffset(60),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("provisional");
  expect(r.outcome).toBe("GOOD");
  expect(r.outOfWindow).toBe(false);
  expect(r.delta1).toBe(15);
  const prefix = findKey(r.messages, "engine_lc_provisional_1h_prefix");
  expect(prefix).toBeDefined();
  expect(prefix!.params!.window).toBe("engine_lc_window_1h");
  expect(prefix!.params!.delta).toBe("+15");
});

test("lifecycleFor: bg_1h captured 35min late → outcome=null + engine_lc_outside_window", () => {
  const meal = makeMeal({
    glucose_before: 100,
    bg_1h: 200,
    bg_1h_at: atOffset(60 + 35),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("provisional");
  expect(r.outcome).toBeNull();
  expect(r.outOfWindow).toBe(true);
  const m = findKey(r.messages, "engine_lc_outside_window");
  expect(m).toBeDefined();
  expect(m!.params!.gap).toBe("+35");
});

/* ──────────────────────────────────────────────────────────────────
   Pending state for fresh meals (no readings, age < 60min).
   ────────────────────────────────────────────────────────────────── */

test("lifecycleFor: fresh meal (age < 60min, no readings) → state='pending'", () => {
  const meal = makeMeal({ glucose_before: 100 });
  const now = new Date(MEAL_MS + 30 * 60_000);

  const r = lifecycleFor(meal, now, SETTINGS);

  expect(r.state).toBe("pending");
  expect(r.outcome).toBeNull();
  expect(r.messages).toHaveLength(1);
  expect(r.messages[0].key).toBe("engine_lc_awaiting_1h");
  expect(r.outOfWindow).toBe(false);
  expect(r.delta1).toBeNull();
  expect(r.delta2).toBeNull();
});

test("lifecycleFor: meal older than 60min with no readings falls through to provisional ICR-ratio", () => {
  const meal = makeMeal({ glucose_before: 100, carbs_grams: 60, insulin_units: 4 });
  const now = new Date(MEAL_MS + 90 * 60_000);

  const r = lifecycleFor(meal, now, SETTINGS);

  expect(r.state).toBe("provisional");
  expect(r.outcome).not.toBeNull();
  expect(hasKey(r.messages, "engine_lc_updates_after_2h")).toBe(true);
});

/* ──────────────────────────────────────────────────────────────────
   speed1 / speed2 surfaced inside `messages`.
   ────────────────────────────────────────────────────────────────── */

test("lifecycleFor: bg_1h Δ surfaces speed1 message with rose verb + +0.25 param", () => {
  const meal = makeMeal({
    glucose_before: 100,
    bg_1h: 115,
    bg_1h_at: atOffset(60),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.speed1).toBeCloseTo(0.25, 5);
  const m = findKey(r.messages, "engine_speed1_rose");
  expect(m).toBeDefined();
  expect(m!.params!.speed).toBe("+0.25");
});

test("lifecycleFor: bg_2h with bg_1h surfaces BOTH speed1 and speed2 keys", () => {
  const meal = makeMeal({
    glucose_before: 100,
    bg_1h: 130, bg_1h_at: atOffset(60),
    bg_2h: 160, bg_2h_at: atOffset(120),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("final");
  expect(r.speed1).toBeCloseTo(0.5, 5);
  expect(r.speed2).toBeCloseTo(0.5, 5);
  expect(r.outcome).toBe("SPIKE");
  const s1 = findKey(r.messages, "engine_speed1_rose");
  const s2 = findKey(r.messages, "engine_speed2_rose");
  expect(s1?.params?.speed).toBe("+0.50");
  expect(s2?.params?.speed).toBe("+0.50");
});

test("lifecycleFor: negative speed surfaces engine_speed1_fell key with signed param", () => {
  const meal = makeMeal({
    glucose_before: 200,
    bg_1h: 170,
    bg_1h_at: atOffset(60),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.speed1).toBeCloseTo(-0.5, 5);
  const m = findKey(r.messages, "engine_speed1_fell");
  expect(m).toBeDefined();
  expect(m!.params!.speed).toBe("-0.50");
});

/* ──────────────────────────────────────────────────────────────────
   Legacy `glucose_after` path: no captured-at, so the ±30 min guard
   is intentionally skipped — pre-Task#15 rows must keep classifying.
   ────────────────────────────────────────────────────────────────── */

test("lifecycleFor: legacy glucose_after (no bg_2h_at) → state='final', window check skipped", () => {
  const meal = makeMeal({
    glucose_before: 100,
    glucose_after: 110,
    bg_2h: null,
    bg_2h_at: null,
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("final");
  expect(r.outcome).toBe("GOOD");
  expect(r.outOfWindow).toBe(false);
  expect(r.delta2).toBe(10);
});
