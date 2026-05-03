// Unit coverage for the per-exercise-type aggregation helpers in
// `lib/exerciseEval.ts` (median / normalizeExerciseType /
// aggregateExerciseTypeStats / personalPatternHeadline).
//
// Why this exists:
//   The "Personal Pattern" panel in the exercise expanded view of
//   /entries reads directly off these helpers. They glue the per-row
//   `evaluateExercise()` outcome to a cross-row personal stat
//   ("your runs usually drop ~40 mg/dL"). A regression here surfaces
//   either as missing context on the user's expanded view or — worse
//   — as a misleading median that contradicts the patternNote() copy
//   sitting right above it.
//
// What we lock in:
//   1. `median()` correctness on empty / odd / even / unsorted input.
//   2. `normalizeExerciseType()` collapses the legacy `hypertrophy`
//      alias into `strength` (so the rename in lib/exercise.ts can't
//      ever silently split a user's strength-training history).
//   3. `aggregateExerciseTypeStats()`:
//        - returns null when the type has no rows
//        - counts EVERY row of the type (including ones with no Δ
//          endpoints) in `count`
//        - skips rows missing a Δ endpoint from the matching median's
//          sample size, but keeps the other median if it does have
//          its endpoints
//        - excludes PENDING outcomes from the hypo-risk numerator
//          AND denominator (mirrors the workout-outcomes card)
//        - merges legacy `hypertrophy` rows into `strength` totals
//   4. `personalPatternHeadline()`:
//        - returns null below the 3-session threshold
//        - prefers the +1h delta over the at-end delta when both are
//          available (captures the delayed-hypo window)
//        - drops to "leave glucose roughly unchanged" copy when the
//          median is in the ±5 mg/dL noise band
//
// Runs as a Playwright unit test (no browser, no dev server) —
// matches the convention established by tests/unit/export.test.ts.

import { test, expect } from "@playwright/test";

import {
  evaluateExercise,
  median,
  normalizeExerciseType,
  aggregateExerciseTypeStats,
  personalPatternHeadline,
  PATTERN_MIN_SESSIONS,
} from "@/lib/exerciseEval";
import type { ExerciseLog, ExerciseType } from "@/lib/exercise";

/** Build an ExerciseLog with sane defaults so individual specs only
 *  set the fields they actually care about. */
function makeExerciseLog(overrides: Partial<ExerciseLog> & { id: string; exercise_type: ExerciseType }): ExerciseLog {
  return {
    user_id: "u1",
    created_at: "2026-04-15T10:00:00Z",
    duration_minutes: 30,
    intensity: "medium",
    cgm_glucose_at_log: null,
    notes: null,
    glucose_at_end: null,
    glucose_after_1h: null,
    ...overrides,
  };
}

// ── median() ────────────────────────────────────────────────────────

test("median() returns null for an empty array", () => {
  expect(median([])).toBeNull();
});

test("median() of a single value is that value", () => {
  expect(median([42])).toBe(42);
});

test("median() of an odd-length array picks the middle of the sorted values", () => {
  // Deliberately unsorted — the helper must sort internally so callers
  // don't need to.
  expect(median([10, -30, 5, 20, 0])).toBe(5);
});

test("median() of an even-length array averages the two middle values", () => {
  expect(median([10, 20, 30, 40])).toBe(25);
});

test("median() handles negatives correctly", () => {
  // Sorted: [-50, -40, -30, -20] → middle pair (-40, -30) → -35.
  expect(median([-30, -50, -20, -40])).toBe(-35);
});

// ── normalizeExerciseType() ─────────────────────────────────────────

test("normalizeExerciseType() collapses 'hypertrophy' to 'strength'", () => {
  expect(normalizeExerciseType("hypertrophy")).toBe("strength");
});

test("normalizeExerciseType() leaves every other type untouched", () => {
  const others: ExerciseType[] = ["strength", "cardio", "hiit", "yoga", "cycling", "run"];
  for (const t of others) expect(normalizeExerciseType(t)).toBe(t);
});

// ── evaluateExercise() — Task #194 dense-curve hypo path ────────────

test("evaluateExercise: had_hypo_window=true forces HYPO_RISK even while PENDING (no at-end yet)", () => {
  // Sparse evaluator would call this PENDING (atEnd null). The dense
  // 0–180 min curve already proved a sub-70 dip happened — reflect
  // it on the badge immediately instead of waiting for the slot.
  const log = makeExerciseLog({
    id: "x", exercise_type: "run",
    cgm_glucose_at_log: 130, glucose_at_end: null, glucose_after_1h: null,
    had_hypo_window: true,
  });
  expect(evaluateExercise(log).outcome).toBe("HYPO_RISK");
});

test("evaluateExercise: had_hypo_window=true forces HYPO_RISK even when both endpoints look fine", () => {
  // Endpoints would otherwise classify STABLE — the curve caught a
  // delayed hypo BETWEEN at-end and +1h that the sparse evaluator
  // missed.
  const log = makeExerciseLog({
    id: "x", exercise_type: "cardio",
    cgm_glucose_at_log: 130, glucose_at_end: 110, glucose_after_1h: 105,
    had_hypo_window: true,
  });
  expect(evaluateExercise(log).outcome).toBe("HYPO_RISK");
});

test("evaluateExercise: had_hypo_window=false leaves the legacy rules in charge", () => {
  // Curve resolved with no hypo — the explicit `false` must not be
  // confused with `true`; the badge stays STABLE.
  const log = makeExerciseLog({
    id: "x", exercise_type: "yoga",
    cgm_glucose_at_log: 120, glucose_at_end: 122, glucose_after_1h: 121,
    had_hypo_window: false,
  });
  expect(evaluateExercise(log).outcome).toBe("STABLE");
});

// ── aggregateExerciseTypeStats() ────────────────────────────────────

test("aggregateExerciseTypeStats() returns null when no rows of the type exist", () => {
  const logs: ExerciseLog[] = [
    makeExerciseLog({ id: "a", exercise_type: "yoga" }),
  ];
  expect(aggregateExerciseTypeStats(logs, "run")).toBeNull();
});

test("aggregateExerciseTypeStats() ignores rows of other types", () => {
  const logs: ExerciseLog[] = [
    makeExerciseLog({ id: "a", exercise_type: "run", cgm_glucose_at_log: 140, glucose_at_end: 100, glucose_after_1h: 95 }),
    makeExerciseLog({ id: "b", exercise_type: "strength", cgm_glucose_at_log: 100, glucose_at_end: 150, glucose_after_1h: 130 }),
  ];
  const stats = aggregateExerciseTypeStats(logs, "run");
  expect(stats).not.toBeNull();
  expect(stats!.count).toBe(1);
  expect(stats!.medianDeltaAtEnd).toBe(-40);
  expect(stats!.medianDelta1h).toBe(-45);
});

test("aggregateExerciseTypeStats() merges legacy 'hypertrophy' rows into 'strength' totals", () => {
  const logs: ExerciseLog[] = [
    makeExerciseLog({ id: "old", exercise_type: "hypertrophy", cgm_glucose_at_log: 100, glucose_at_end: 130, glucose_after_1h: 125 }),
    makeExerciseLog({ id: "new", exercise_type: "strength",    cgm_glucose_at_log: 100, glucose_at_end: 120, glucose_after_1h: 115 }),
    makeExerciseLog({ id: "n2",  exercise_type: "strength",    cgm_glucose_at_log: 100, glucose_at_end: 110, glucose_after_1h: 105 }),
  ];
  const fromStrength = aggregateExerciseTypeStats(logs, "strength");
  const fromLegacy   = aggregateExerciseTypeStats(logs, "hypertrophy");
  // Both lookup keys must collapse into the same merged result.
  expect(fromStrength).toEqual(fromLegacy);
  expect(fromStrength!.count).toBe(3);
  expect(fromStrength!.type).toBe("strength");
  // Sorted at-end deltas: [+10, +20, +30] → median +20.
  expect(fromStrength!.medianDeltaAtEnd).toBe(20);
  // Sorted +1h deltas:   [+5, +15, +25] → median +15.
  expect(fromStrength!.medianDelta1h).toBe(15);
});

test("aggregateExerciseTypeStats() counts rows missing Δ endpoints in `count` but skips them from the matching median", () => {
  const logs: ExerciseLog[] = [
    // Row 1: full triple — contributes to BOTH medians.
    makeExerciseLog({ id: "a", exercise_type: "cardio", cgm_glucose_at_log: 140, glucose_at_end: 100, glucose_after_1h: 90 }),
    // Row 2: at-end only, no +1h — contributes only to medianDeltaAtEnd.
    makeExerciseLog({ id: "b", exercise_type: "cardio", cgm_glucose_at_log: 130, glucose_at_end: 110, glucose_after_1h: null }),
    // Row 3: nothing yet (PENDING) — counted in `count`, contributes to neither.
    makeExerciseLog({ id: "c", exercise_type: "cardio", cgm_glucose_at_log: 150, glucose_at_end: null, glucose_after_1h: null }),
  ];
  const stats = aggregateExerciseTypeStats(logs, "cardio")!;
  expect(stats.count).toBe(3);
  expect(stats.atEndSampleSize).toBe(2);
  expect(stats.oneHourSampleSize).toBe(1);
  // At-end deltas: [-40, -20] → median -30.
  expect(stats.medianDeltaAtEnd).toBe(-30);
  // +1h delta: [-50] → median -50.
  expect(stats.medianDelta1h).toBe(-50);
});

test("aggregateExerciseTypeStats() excludes PENDING rows from the hypo-risk numerator AND denominator", () => {
  const logs: ExerciseLog[] = [
    // STABLE (atEnd = before, no hypo).
    makeExerciseLog({ id: "1", exercise_type: "yoga", cgm_glucose_at_log: 120, glucose_at_end: 122 }),
    // HYPO_RISK (atEnd < 70).
    makeExerciseLog({ id: "2", exercise_type: "yoga", cgm_glucose_at_log: 120, glucose_at_end:  60 }),
    // PENDING (atEnd missing) — must NOT count.
    makeExerciseLog({ id: "3", exercise_type: "yoga", cgm_glucose_at_log: 120, glucose_at_end: null }),
  ];
  const stats = aggregateExerciseTypeStats(logs, "yoga")!;
  expect(stats.count).toBe(3);
  expect(stats.classifiedCount).toBe(2);
  expect(stats.hypoRiskCount).toBe(1);
  expect(stats.hypoRiskShare).toBeCloseTo(0.5, 5);
});

// Task #194: when the dense 0–180 min curve has resolved (`min_bg_180`
// is set), aggregateExerciseTypeStats prefers it over the per-row
// evaluator for the hypo signal — catching dips between the at-end
// and +1h slots that the sparse evaluator would otherwise miss.
test("aggregateExerciseTypeStats() honours min_bg_180 for the hypo-risk-share even when at-end is null", () => {
  const logs: ExerciseLog[] = [
    // Curve resolved, min stayed safely above 70 → counts as classified, no hypo.
    makeExerciseLog({ id: "1", exercise_type: "cycling", cgm_glucose_at_log: 130, glucose_at_end: null, min_bg_180: 95, had_hypo_window: false }),
    // Curve resolved with a dip below 70 → classified as hypo even
    // though at-end is null (legacy evaluator would have called this
    // PENDING and excluded it entirely).
    makeExerciseLog({ id: "2", exercise_type: "cycling", cgm_glucose_at_log: 130, glucose_at_end: null, min_bg_180: 62, had_hypo_window: true }),
    // Curve resolved, no hypo, endpoints landed → STABLE.
    makeExerciseLog({ id: "3", exercise_type: "cycling", cgm_glucose_at_log: 120, glucose_at_end: 118, min_bg_180: 100, had_hypo_window: false }),
  ];
  const stats = aggregateExerciseTypeStats(logs, "cycling")!;
  expect(stats.classifiedCount).toBe(3);
  expect(stats.hypoRiskCount).toBe(1);
  expect(stats.hypoRiskShare).toBeCloseTo(1 / 3, 5);
});

test("aggregateExerciseTypeStats() returns hypoRiskShare = null when no row is classified yet", () => {
  const logs: ExerciseLog[] = [
    makeExerciseLog({ id: "1", exercise_type: "run", cgm_glucose_at_log: 120, glucose_at_end: null }),
    makeExerciseLog({ id: "2", exercise_type: "run", cgm_glucose_at_log: 110, glucose_at_end: null }),
  ];
  const stats = aggregateExerciseTypeStats(logs, "run")!;
  expect(stats.count).toBe(2);
  expect(stats.classifiedCount).toBe(0);
  expect(stats.hypoRiskCount).toBe(0);
  expect(stats.hypoRiskShare).toBeNull();
});

// ── personalPatternHeadline() ───────────────────────────────────────

test("personalPatternHeadline() returns null below the 3-session threshold", () => {
  const logs: ExerciseLog[] = [
    makeExerciseLog({ id: "1", exercise_type: "run", cgm_glucose_at_log: 140, glucose_at_end: 100, glucose_after_1h: 90 }),
    makeExerciseLog({ id: "2", exercise_type: "run", cgm_glucose_at_log: 140, glucose_at_end: 100, glucose_after_1h: 90 }),
  ];
  const stats = aggregateExerciseTypeStats(logs, "run")!;
  expect(stats.count).toBe(2);
  expect(stats.count).toBeLessThan(PATTERN_MIN_SESSIONS);
  expect(personalPatternHeadline(stats)).toBeNull();
});

test("personalPatternHeadline() prefers the +1h median over the at-end median when both exist", () => {
  // Three runs where at-end says -20 but +1h says -50 (delayed-hypo
  // window — the worse / more relevant number for the user).
  const logs: ExerciseLog[] = [
    makeExerciseLog({ id: "1", exercise_type: "run", cgm_glucose_at_log: 150, glucose_at_end: 130, glucose_after_1h: 100 }),
    makeExerciseLog({ id: "2", exercise_type: "run", cgm_glucose_at_log: 150, glucose_at_end: 130, glucose_after_1h: 100 }),
    makeExerciseLog({ id: "3", exercise_type: "run", cgm_glucose_at_log: 150, glucose_at_end: 130, glucose_after_1h: 100 }),
  ];
  const stats = aggregateExerciseTypeStats(logs, "run")!;
  expect(stats.medianDeltaAtEnd).toBe(-20);
  expect(stats.medianDelta1h).toBe(-50);
  const headline = personalPatternHeadline(stats);
  expect(headline).not.toBeNull();
  // Picks the +1h delta value, not the at-end one.
  expect(headline).toContain("~50");
  expect(headline).not.toContain("~20");
  expect(headline).toContain("drop");
});

test("personalPatternHeadline() uses the 'roughly unchanged' copy when the median is inside the ±5 mg/dL noise band", () => {
  const logs: ExerciseLog[] = [
    makeExerciseLog({ id: "1", exercise_type: "yoga", cgm_glucose_at_log: 120, glucose_at_end: 122, glucose_after_1h: 121 }),
    makeExerciseLog({ id: "2", exercise_type: "yoga", cgm_glucose_at_log: 120, glucose_at_end: 122, glucose_after_1h: 121 }),
    makeExerciseLog({ id: "3", exercise_type: "yoga", cgm_glucose_at_log: 120, glucose_at_end: 122, glucose_after_1h: 121 }),
  ];
  const stats = aggregateExerciseTypeStats(logs, "yoga")!;
  expect(stats.medianDelta1h).toBe(1);
  const headline = personalPatternHeadline(stats);
  expect(headline).not.toBeNull();
  expect(headline).toMatch(/roughly unchanged/i);
});

test("personalPatternHeadline() falls back to the at-end median when no +1h reading is available", () => {
  const logs: ExerciseLog[] = [
    makeExerciseLog({ id: "1", exercise_type: "hiit", cgm_glucose_at_log: 100, glucose_at_end: 145, glucose_after_1h: null }),
    makeExerciseLog({ id: "2", exercise_type: "hiit", cgm_glucose_at_log: 100, glucose_at_end: 140, glucose_after_1h: null }),
    makeExerciseLog({ id: "3", exercise_type: "hiit", cgm_glucose_at_log: 100, glucose_at_end: 150, glucose_after_1h: null }),
  ];
  const stats = aggregateExerciseTypeStats(logs, "hiit")!;
  expect(stats.medianDelta1h).toBeNull();
  expect(stats.medianDeltaAtEnd).toBe(45);
  const headline = personalPatternHeadline(stats);
  expect(headline).not.toBeNull();
  expect(headline).toContain("~45");
  expect(headline).toContain("raise");
});
