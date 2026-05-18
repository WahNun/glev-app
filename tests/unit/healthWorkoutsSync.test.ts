import { test, expect } from "@playwright/test";
import {
  normaliseHealthWorkout,
  mapWorkoutType,
  HEALTH_WORKOUTS_MAX_BATCH,
} from "../../lib/healthWorkoutsNormalise";

/**
 * Imports the SAME normaliser that
 * `app/api/health/workouts/sync/route.ts` runs. Mirrored-validator
 * drift is therefore impossible — any regression in the route's
 * per-sample handling fails this test by construction.
 */

test("HEALTH_WORKOUTS_MAX_BATCH exposes a sane upper bound", () => {
  expect(HEALTH_WORKOUTS_MAX_BATCH).toBeGreaterThan(50);
  expect(HEALTH_WORKOUTS_MAX_BATCH).toBeLessThanOrEqual(1000);
});

test("rejects samples missing uuid / type / dates", () => {
  expect(
    normaliseHealthWorkout({
      workoutType: "running",
      startDate: "2026-05-17T10:00:00Z",
      endDate: "2026-05-17T10:30:00Z",
    }),
  ).toBeNull();
  expect(
    normaliseHealthWorkout({
      uuid: "abc",
      startDate: "2026-05-17T10:00:00Z",
      endDate: "2026-05-17T10:30:00Z",
    }),
  ).toBeNull();
  expect(
    normaliseHealthWorkout({
      uuid: "abc",
      workoutType: "running",
      startDate: "not-a-date",
      endDate: "2026-05-17T10:30:00Z",
    }),
  ).toBeNull();
});

test("rejects zero-second or inverted workout windows", () => {
  expect(
    normaliseHealthWorkout({
      uuid: "abc",
      workoutType: "running",
      startDate: "2026-05-17T10:00:00Z",
      endDate: "2026-05-17T10:00:00Z",
    }),
  ).toBeNull();
  expect(
    normaliseHealthWorkout({
      uuid: "abc",
      workoutType: "running",
      startDate: "2026-05-17T10:30:00Z",
      endDate: "2026-05-17T10:00:00Z",
    }),
  ).toBeNull();
  // Less than 1-minute rounded duration → rejected so we don't emit
  // 0-minute rows that fail the duration_minutes > 0 CHECK.
  expect(
    normaliseHealthWorkout({
      uuid: "abc",
      workoutType: "running",
      startDate: "2026-05-17T10:00:00Z",
      endDate: "2026-05-17T10:00:20Z",
    }),
  ).toBeNull();
});

test("clamps multi-day workouts to the 600-minute CHECK ceiling", () => {
  const n = normaliseHealthWorkout({
    uuid: "abc",
    workoutType: "running",
    startDate: "2026-05-17T00:00:00Z",
    endDate: "2026-05-19T00:00:00Z",
  });
  expect(n?.duration_minutes).toBe(600);
});

test("accepts valid workout and defaults intensity / clears HR", () => {
  const n = normaliseHealthWorkout({
    uuid: "F0A1-1234",
    workoutType: "cycling",
    startDate: "2026-05-17T10:00:00Z",
    endDate: "2026-05-17T10:45:00Z",
  });
  expect(n).toEqual({
    external_id: "F0A1-1234",
    exercise_type: "cycling",
    intensity: "medium",
    duration_minutes: 45,
    started_at: "2026-05-17T10:00:00.000Z",
    ended_at: "2026-05-17T10:45:00.000Z",
    avg_heart_rate: null,
    max_heart_rate: null,
    notes: null,
  });
});

test("keeps valid heart-rate values and drops out-of-range ones", () => {
  const ok = normaliseHealthWorkout({
    uuid: "abc",
    workoutType: "running",
    startDate: "2026-05-17T10:00:00Z",
    endDate: "2026-05-17T10:30:00Z",
    avgHeartRate: 142.4,
    maxHeartRate: 178,
  });
  expect(ok?.avg_heart_rate).toBe(142);
  expect(ok?.max_heart_rate).toBe(178);

  const bad = normaliseHealthWorkout({
    uuid: "abc",
    workoutType: "running",
    startDate: "2026-05-17T10:00:00Z",
    endDate: "2026-05-17T10:30:00Z",
    avgHeartRate: 999,
    maxHeartRate: -5,
  });
  expect(bad?.avg_heart_rate).toBeNull();
  expect(bad?.max_heart_rate).toBeNull();
});

test("maps HealthKit workout slugs onto Glev exercise types", () => {
  expect(mapWorkoutType("running")).toBe("run");
  expect(mapWorkoutType("runningTreadmill")).toBe("run");
  expect(mapWorkoutType("cycling")).toBe("cycling");
  expect(mapWorkoutType("swimmingPool")).toBe("swimming");
  expect(mapWorkoutType("rowingMachine")).toBe("swimming");
  expect(mapWorkoutType("strengthTraining")).toBe("strength");
  expect(mapWorkoutType("functionalStrengthTraining")).toBe("strength");
  expect(mapWorkoutType("highIntensityIntervalTraining")).toBe("hiit");
  expect(mapWorkoutType("yoga")).toBe("yoga");
  expect(mapWorkoutType("guidedBreathing")).toBe("breathwork");
  expect(mapWorkoutType("soccer")).toBe("football");
  expect(mapWorkoutType("tennis")).toBe("tennis");
  expect(mapWorkoutType("basketball")).toBe("basketball");
  expect(mapWorkoutType("volleyball")).toBe("volleyball");
  // Unknown slugs fall back to "cardio" so the row is never dropped,
  // only generalised — the engine's safety hook only needs the time
  // window today.
  expect(mapWorkoutType("zorbing")).toBe("cardio");
  expect(mapWorkoutType("walking")).toBe("cardio");
});
