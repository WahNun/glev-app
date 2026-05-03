// Shared fixture builders for the engine unit-test suite (Task #186).
//
// The engine modules consume rich domain types (Meal, InsulinLog,
// ExerciseLog, Pattern, AdaptiveSettings, AdaptiveICR). Building one
// from scratch in every spec drowns the actual assertion in noise, so
// these helpers expose tiny `make*` factories that fill in sane
// defaults and let each spec override only the fields under test.

import type { Meal } from "@/lib/meals";
import type { InsulinLog } from "@/lib/insulin";
import type { ExerciseLog, ExerciseType, ExerciseIntensity } from "@/lib/exercise";
import type { AdaptiveICR } from "@/lib/engine/adaptiveICR";
import type { Pattern, PatternType } from "@/lib/engine/patterns";
import type { AdaptiveSettings } from "@/lib/engine/adjustment";

/** Stable base instant — keeps lifecycle.ageMinutes / wall-clock checks
 *  predictable. All offsets in fixtures are relative to this. */
export const FIXTURE_BASE_MS = Date.parse("2026-04-30T08:00:00Z");
export const FIXTURE_NOW = new Date(FIXTURE_BASE_MS + 7 * 24 * 3600_000);

export function makeMeal(overrides: Partial<Meal> & { id?: string } = {}): Meal {
  const id = overrides.id ?? "m_" + Math.random().toString(36).slice(2, 8);
  const mealMs = FIXTURE_BASE_MS;
  return {
    id,
    user_id: "u1",
    input_text: "",
    parsed_json: [],
    glucose_before: 100,
    glucose_after: null,
    bg_1h: null,
    bg_1h_at: null,
    bg_2h: null,
    bg_2h_at: null,
    glucose_30min: null, glucose_30min_at: null,
    glucose_1h: null, glucose_1h_at: null,
    glucose_90min: null, glucose_90min_at: null,
    glucose_2h: null, glucose_2h_at: null,
    glucose_3h: null, glucose_3h_at: null,
    outcome_state: null,
    min_bg_180: null, max_bg_180: null, time_to_peak_min: null,
    auc_180: null, had_hypo_window: null, min_bg_60_180: null,
    meal_time: new Date(mealMs).toISOString(),
    carbs_grams: 50,
    protein_grams: 10,
    fat_grams: 5,
    fiber_grams: 3,
    calories: null,
    insulin_units: 4,
    meal_type: "BALANCED",
    evaluation: null,
    related_meal_id: null,
    created_at: new Date(mealMs).toISOString(),
    ...overrides,
  };
}

/** Build a meal whose bg_2h is captured exactly at meal_time + 120min so
 *  `lifecycleFor` returns `state: "final"` deterministically; `delta`
 *  drives the final outcome (delta=10 → GOOD, +60 → SPIKE, etc.). */
export function makeFinalMeal(
  id: string,
  delta: number,
  overrides: Partial<Meal> = {},
): Meal {
  // Resolve meal_time first so bg_2h_at lands within the ±30 min
  // validation window relative to the *actual* meal time, not the
  // fixture base (callers often override meal_time to spread fixtures
  // across hours-of-day for adaptiveICR bucketing).
  const mealIso = overrides.meal_time ?? new Date(FIXTURE_BASE_MS).toISOString();
  const mealMs = Date.parse(mealIso);
  const before = overrides.glucose_before ?? 100;
  return makeMeal({
    id,
    glucose_before: before,
    bg_2h: before + delta,
    bg_2h_at: new Date(mealMs + 120 * 60_000).toISOString(),
    meal_time: mealIso,
    created_at: mealIso,
    ...overrides,
  });
}

export function makeInsulinLog(overrides: Partial<InsulinLog> & { id?: string } = {}): InsulinLog {
  return {
    id: overrides.id ?? "i_" + Math.random().toString(36).slice(2, 8),
    user_id: "u1",
    created_at: new Date(FIXTURE_BASE_MS).toISOString(),
    insulin_type: "bolus",
    insulin_name: "Novorapid",
    units: 4,
    cgm_glucose_at_log: null,
    notes: null,
    glucose_after_1h: null,
    glucose_after_2h: null,
    related_entry_id: null,
    ...overrides,
  };
}

export function makeExerciseLog(overrides: Partial<ExerciseLog> & { id?: string } = {}): ExerciseLog {
  return {
    id: overrides.id ?? "e_" + Math.random().toString(36).slice(2, 8),
    user_id: "u1",
    created_at: new Date(FIXTURE_BASE_MS).toISOString(),
    exercise_type: "cardio" as ExerciseType,
    duration_minutes: 30,
    intensity: "medium" as ExerciseIntensity,
    cgm_glucose_at_log: null,
    notes: null,
    glucose_at_end: null,
    glucose_after_1h: null,
    ...overrides,
  };
}

export function makeAdaptiveICR(overrides: Partial<AdaptiveICR> = {}): AdaptiveICR {
  return {
    global: null, morning: null, afternoon: null, evening: null,
    sampleSize: 0,
    ...overrides,
  };
}

export function makePattern(overrides: Partial<Pattern> & { type: PatternType }): Pattern {
  return {
    label: overrides.type,
    explanation: "",
    confidence: "high",
    sampleSize: 15,
    counts: { good: 0, underdose: 0, overdose: 0, spike: 0 },
    ...overrides,
  };
}

export function makeAdaptiveSettings(overrides: Partial<AdaptiveSettings> = {}): AdaptiveSettings {
  return {
    icr: 15,
    correctionFactor: 50,
    lastUpdated: null,
    adjustmentHistory: [],
    ...overrides,
  };
}
