// Unit coverage for `lib/engine/lifecycle.ts` — the unified meal
// evaluator introduced by Task #15 (and now pinned by Task #41).
//
// Why this exists:
//   `lifecycleFor` collapsed four overlapping evaluation paths into a
//   single Pending → Provisional → Final state machine. Three behaviours
//   are critical and easy to silently regress in a future refactor:
//
//     1. The ±30 min validation window guard. A bg_2h or bg_1h reading
//        whose `*_at` timestamp lies more than 30 min away from the
//        expected capture time (meal_time + 120min / + 60min) must NOT
//        be used to classify the meal — the row stays provisional with
//        `outcome: null` and the reasoning string carries the actual
//        gap so the entries page can explain why.
//     2. The Pending state for fresh meals (age < 60min, no readings).
//     3. The numeric speed1 / speed2 surfacing inside `reasoning`
//        (e.g. "BG rose at +1.00 mg/dL/min in the first hour."), which
//        the entries drawer renders verbatim.
//
// Why this is a Playwright spec (no browser):
//   The project's only test runner is Playwright (`npm test` →
//   `playwright test`), and the widened `testDir: "./tests"` in
//   `playwright.config.ts` automatically picks up files under
//   `tests/unit/*.test.ts` alongside the existing e2e specs. None of
//   these checks touch `page` / the dev server.

import { test, expect } from "@playwright/test";

import { lifecycleFor } from "@/lib/engine/lifecycle";
import type { Meal } from "@/lib/meals";
import type { InsulinSettings } from "@/lib/userSettings";

/* ──────────────────────────────────────────────────────────────────
   Fixture builders.
   ────────────────────────────────────────────────────────────────── */

/** Fixed reference time (UTC) used by every test in this file so the
 *  ±30 min window math is deterministic regardless of when the suite
 *  runs. The matching `NOW` is `MEAL_TIME + 3h` — well past the 2h
 *  window — so meals without readings deterministically fall into the
 *  "older with no readings" branch instead of "pending". */
const MEAL_TIME = "2026-04-30T08:00:00Z";
const MEAL_MS = Date.parse(MEAL_TIME);
const NOW = new Date(MEAL_MS + 3 * 60 * 60_000);

/** Personal insulin parameters — pinned so the no-bgAfter ICR fallback
 *  branch is deterministic across machines (avoids the `getInsulinSettings`
 *  localStorage read entirely under the test runner). */
const SETTINGS: InsulinSettings = { icr: 15, cf: 50, targetBg: 110 };

/** Minutes-after-meal helper → ISO timestamp. */
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
  // GOOD reasoning template from `lib/engine/evaluation.ts`.
  expect(r.reasoning).toContain("dose matched the meal");
});

test("lifecycleFor: bg_2h captured 25min late → still inside window → state='final'", () => {
  // +25 min from the expected +120 → actual gap = +25 min, |gap| <= 30.
  const meal = makeMeal({
    glucose_before: 100,
    bg_2h: 170,
    bg_2h_at: atOffset(120 + 25),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("final");
  // Δ70 > 55 (BALANCED spike cutoff) → SPIKE.
  expect(r.outcome).toBe("SPIKE");
  expect(r.outOfWindow).toBe(false);
});

/* ──────────────────────────────────────────────────────────────────
   2-hour reading outside ±30 min window → outcome dropped.
   ────────────────────────────────────────────────────────────────── */

test("lifecycleFor: bg_2h captured 47min late → outcome=null + 'Reading outside expected window' reasoning", () => {
  const meal = makeMeal({
    glucose_before: 100,
    bg_2h: 170,
    bg_2h_at: atOffset(120 + 47),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("provisional");
  expect(r.outcome).toBeNull();
  expect(r.outOfWindow).toBe(true);
  expect(r.reasoning).toContain("Reading outside expected window");
  // Spec requires the actual signed gap to surface so the user can see why.
  expect(r.reasoning).toContain("+47 min");
  // Even though the reading was dropped from outcome inference, the raw
  // delta is still computed for chart / debug surfaces.
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
  expect(r.reasoning).toContain("Reading outside expected window");
  // Negative gap should surface with its sign for debugging.
  expect(r.reasoning).toContain("-45 min");
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
  // Δ15 within ±30 → GOOD.
  expect(r.outcome).toBe("GOOD");
  expect(r.outOfWindow).toBe(false);
  expect(r.delta1).toBe(15);
  // The provisional path prepends a "1-hour check" / "early check" prefix
  // and the explicit Δ — both checked here so a future refactor can't
  // silently drop them.
  expect(r.reasoning).toContain("1-hour check");
  expect(r.reasoning).toContain("Δ +15 mg/dL");
});

test("lifecycleFor: bg_1h captured 35min late → outcome=null + 'Reading outside expected window'", () => {
  const meal = makeMeal({
    glucose_before: 100,
    bg_1h: 200,
    bg_1h_at: atOffset(60 + 35),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("provisional");
  expect(r.outcome).toBeNull();
  expect(r.outOfWindow).toBe(true);
  expect(r.reasoning).toContain("Reading outside expected window");
  expect(r.reasoning).toContain("+35 min");
});

/* ──────────────────────────────────────────────────────────────────
   Pending state for fresh meals (no readings, age < 60min).
   ────────────────────────────────────────────────────────────────── */

test("lifecycleFor: fresh meal (age < 60min, no readings) → state='pending'", () => {
  const meal = makeMeal({ glucose_before: 100 });
  // 30 min after meal — squarely inside the pending window.
  const now = new Date(MEAL_MS + 30 * 60_000);

  const r = lifecycleFor(meal, now, SETTINGS);

  expect(r.state).toBe("pending");
  expect(r.outcome).toBeNull();
  expect(r.reasoning).toBe("Awaiting 1-hour glucose check.");
  expect(r.outOfWindow).toBe(false);
  expect(r.delta1).toBeNull();
  expect(r.delta2).toBeNull();
});

test("lifecycleFor: meal older than 60min with no readings falls through to provisional ICR-ratio", () => {
  // 90 min after meal — past the pending window, no bg readings → the
  // fallback ICR-ratio branch decides the outcome.
  const meal = makeMeal({ glucose_before: 100, carbs_grams: 60, insulin_units: 4 });
  const now = new Date(MEAL_MS + 90 * 60_000);

  const r = lifecycleFor(meal, now, SETTINGS);

  expect(r.state).toBe("provisional");
  expect(r.outcome).not.toBeNull();
  // Pre-2h "Updates after 2-hour reading." note is appended to the
  // ICR-ratio reasoning string.
  expect(r.reasoning).toContain("Updates after 2-hour reading.");
});

/* ──────────────────────────────────────────────────────────────────
   speed1 / speed2 surfaced inside `reasoning`.
   ────────────────────────────────────────────────────────────────── */

test("lifecycleFor: bg_1h Δ surfaces speed1 in reasoning ('+0.25 mg/dL/min in the first hour')", () => {
  // Δ +15 mg/dL over 60 min → speed1 = 0.25 mg/dL/min.
  const meal = makeMeal({
    glucose_before: 100,
    bg_1h: 115,
    bg_1h_at: atOffset(60),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.speed1).toBeCloseTo(0.25, 5);
  expect(r.reasoning).toContain("BG rose at +0.25 mg/dL/min in the first hour.");
});

test("lifecycleFor: bg_2h with bg_1h surfaces BOTH speed1 and speed2 in reasoning", () => {
  // Δ1 = +30 → speed1 = 0.50; Δ2 = +60 → speed2 = 0.50.
  const meal = makeMeal({
    glucose_before: 100,
    bg_1h: 130, bg_1h_at: atOffset(60),
    bg_2h: 160, bg_2h_at: atOffset(120),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.state).toBe("final");
  expect(r.speed1).toBeCloseTo(0.5, 5);
  expect(r.speed2).toBeCloseTo(0.5, 5);
  // BALANCED spike cutoff is 55 → Δ60 → SPIKE.
  expect(r.outcome).toBe("SPIKE");
  // Both speed sentences are appended to the SPIKE reasoning template.
  expect(r.reasoning).toContain("BG rose at +0.50 mg/dL/min in the first hour.");
  expect(r.reasoning).toContain("BG rose at +0.50 mg/dL/min over the 2-hour window.");
});

test("lifecycleFor: negative speed surfaces 'fell at -X.XX' verb (drop after meal)", () => {
  // Δ1 = -30 → speed1 = -0.50.
  const meal = makeMeal({
    glucose_before: 200,
    bg_1h: 170,
    bg_1h_at: atOffset(60),
  });

  const r = lifecycleFor(meal, NOW, SETTINGS);

  expect(r.speed1).toBeCloseTo(-0.5, 5);
  expect(r.reasoning).toContain("BG fell at -0.50 mg/dL/min in the first hour.");
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
