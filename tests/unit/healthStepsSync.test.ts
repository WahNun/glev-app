import { test, expect } from "@playwright/test";
import {
  normaliseHealthStepsSample,
  HEALTH_STEPS_MAX_STEPS,
  HEALTH_STEPS_MAX_ACTIVE_MIN,
} from "../../lib/healthStepsNormalise";

/**
 * Imports the SAME normaliser that `app/api/health/steps/sync/route.ts`
 * runs. Mirrored-validator drift is now impossible: any regression in
 * the route's input handling fails this test by construction.
 */

test("rejects malformed dates", () => {
  expect(normaliseHealthStepsSample({ date: "not-a-date", steps: 100 })).toBeNull();
  expect(normaliseHealthStepsSample({ date: "2026-13-40", steps: 100 })).toBeNull();
  expect(normaliseHealthStepsSample({ date: "", steps: 100 })).toBeNull();
});

test("strict calendar validation rejects rollover dates", () => {
  // The plain `new Date("2026-02-31T00:00:00Z")` path silently rolls
  // over to March — the strict roundtrip validator rejects it.
  expect(normaliseHealthStepsSample({ date: "2026-02-31", steps: 100 })).toBeNull();
  expect(normaliseHealthStepsSample({ date: "2025-04-31", steps: 100 })).toBeNull();
  expect(normaliseHealthStepsSample({ date: "2025-00-15", steps: 100 })).toBeNull();
  // 2024 is a leap year — Feb 29 is valid.
  expect(normaliseHealthStepsSample({ date: "2024-02-29", steps: 1 })?.date).toBe("2024-02-29");
  // 2025 is not — Feb 29 must be rejected.
  expect(normaliseHealthStepsSample({ date: "2025-02-29", steps: 1 })).toBeNull();
});

test("rejects negative or out-of-range steps", () => {
  expect(normaliseHealthStepsSample({ date: "2026-05-17", steps: -1 })).toBeNull();
  expect(normaliseHealthStepsSample({ date: "2026-05-17", steps: HEALTH_STEPS_MAX_STEPS + 1 })).toBeNull();
});

test("accepts valid samples and rounds floats", () => {
  expect(normaliseHealthStepsSample({ date: "2026-05-17", steps: 8432.6 })).toEqual({
    date: "2026-05-17",
    steps: 8433,
    active_minutes: null,
  });
});

test("drops invalid active_minutes but keeps the row", () => {
  const ok = normaliseHealthStepsSample({
    date: "2026-05-17",
    steps: 100,
    activeMinutes: HEALTH_STEPS_MAX_ACTIVE_MIN + 1,
  });
  expect(ok).toEqual({ date: "2026-05-17", steps: 100, active_minutes: null });
});

test("accepts valid active_minutes", () => {
  const ok = normaliseHealthStepsSample({ date: "2026-05-17", steps: 100, activeMinutes: 45 });
  expect(ok?.active_minutes).toBe(45);
});
