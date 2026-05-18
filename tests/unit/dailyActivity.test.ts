import { test, expect } from "@playwright/test";
import {
  summariseActivityContext,
  todayLocalIso,
  type DailyActivityRow,
} from "../../lib/dailyActivity";
import { recommendDose } from "../../lib/engine/recommendation";
import { evaluateEntry, isHighActivityDay } from "../../lib/engine/evaluation";
import { makeAdaptiveICR } from "../support/engineFixtures";

const FROZEN_TODAY = "2026-05-17";

function row(date: string, steps: number): DailyActivityRow {
  return { date, steps, active_minutes: null, source: "apple_health" };
}

test("summariseActivityContext: empty input", () => {
  const c = summariseActivityContext([], FROZEN_TODAY);
  expect(c.todaySteps).toBeNull();
  expect(c.avgSteps7d).toBeNull();
  expect(c.sampleSize7d).toBe(0);
});

test("summariseActivityContext: finds today + averages last 7 newest-first", () => {
  const rows: DailyActivityRow[] = [
    row("2026-05-17", 12000),
    row("2026-05-16",  6000),
    row("2026-05-15",  5000),
    row("2026-05-14",  7000),
    row("2026-05-13",  4000),
    row("2026-05-12",  9000),
    row("2026-05-11",  3000),
    row("2026-05-10", 99999), // out of window — must NOT count
  ];
  const c = summariseActivityContext(rows, FROZEN_TODAY);
  expect(c.todaySteps).toBe(12000);
  expect(c.sampleSize7d).toBe(7);
  // (12000+6000+5000+7000+4000+9000+3000)/7 = 6571.4… → 6571
  expect(c.avgSteps7d).toBe(6571);
});

test("summariseActivityContext: no row for today → null todaySteps", () => {
  const c = summariseActivityContext(
    [row("2026-05-16", 8000), row("2026-05-15", 7500)],
    FROZEN_TODAY,
  );
  expect(c.todaySteps).toBeNull();
  expect(c.avgSteps7d).toBe(7750);
  expect(c.sampleSize7d).toBe(2);
});

test("todayLocalIso: stable YYYY-MM-DD format", () => {
  const s = todayLocalIso(new Date(2026, 0, 5, 14, 30)); // Jan 5
  expect(s).toBe("2026-01-05");
});

// ── Engine integration: activity is a pure annotation, never alters dose ──

const baseInput = {
  carbs: 40,
  currentBG: 130,
  targetBG: 100,
  correctionFactor: 50,
  adaptiveICR: makeAdaptiveICR({ global: 10, sampleSize: 12 }),
  timeOfDay: "afternoon" as const,
};

test("recommendDose: high activity adds annotation but keeps dose unchanged", () => {
  const baseline = recommendDose({ ...baseInput });
  const withActivity = recommendDose({
    ...baseInput,
    activityContext: {
      todaySteps: 14000,
      avgSteps7d: 8000,
      sampleSize7d: 7,
    },
  });
  expect(withActivity.recommendedUnits).toBe(baseline.recommendedUnits);
  expect(withActivity.carbDose).toBe(baseline.carbDose);
  expect(withActivity.correctionDose).toBe(baseline.correctionDose);
  expect(
    withActivity.messages.some((m) => m.key === "engine_rec_high_activity"),
  ).toBe(true);
  expect(
    baseline.messages.some((m) => m.key === "engine_rec_high_activity"),
  ).toBe(false);
});

test("recommendDose: normal activity → no annotation", () => {
  const out = recommendDose({
    ...baseInput,
    activityContext: {
      todaySteps: 8500,
      avgSteps7d: 8000,
      sampleSize7d: 7,
    },
  });
  expect(
    out.messages.some((m) => m.key === "engine_rec_high_activity"),
  ).toBe(false);
});

test("recommendDose: thin sample (<3 days) suppresses annotation", () => {
  const out = recommendDose({
    ...baseInput,
    activityContext: {
      todaySteps: 20000,
      avgSteps7d: 4000,
      sampleSize7d: 2,
    },
  });
  expect(
    out.messages.some((m) => m.key === "engine_rec_high_activity"),
  ).toBe(false);
});

test("recommendDose: high ratio but tiny absolute → no annotation", () => {
  const out = recommendDose({
    ...baseInput,
    activityContext: {
      todaySteps: 4000,    // 2x average but below the 8000 absolute floor
      avgSteps7d: 1500,
      sampleSize7d: 7,
    },
  });
  expect(
    out.messages.some((m) => m.key === "engine_rec_high_activity"),
  ).toBe(false);
});

// ── Runtime engine path (lifecycleFor → evaluateEntry) ─────────────────

test("isHighActivityDay: matches the documented thresholds", () => {
  expect(isHighActivityDay(null)).toBe(false);
  expect(isHighActivityDay({ todaySteps: 14000, avgSteps7d: 8000, sampleSize7d: 7 })).toBe(true);
  // below absolute floor
  expect(isHighActivityDay({ todaySteps: 7000, avgSteps7d: 4000, sampleSize7d: 7 })).toBe(false);
  // ratio < 1.3
  expect(isHighActivityDay({ todaySteps: 9000, avgSteps7d: 8000, sampleSize7d: 7 })).toBe(false);
  // sample too small
  expect(isHighActivityDay({ todaySteps: 14000, avgSteps7d: 8000, sampleSize7d: 2 })).toBe(false);
});

test("evaluateEntry: activityContext adds engine_ctx_high_activity without changing outcome", () => {
  const base = evaluateEntry({
    carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110,
  });
  const withAct = evaluateEntry({
    carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110,
    activityContext: { todaySteps: 14000, avgSteps7d: 8000, sampleSize7d: 7 },
  });
  expect(withAct.outcome).toBe(base.outcome);
  expect(withAct.delta).toBe(base.delta);
  expect(withAct.messages.some(m => m.key === "engine_ctx_high_activity")).toBe(true);
  expect(base.messages.some(m => m.key === "engine_ctx_high_activity")).toBe(false);
});

test("evaluateEntry: normal-activity context does NOT add the annotation", () => {
  const out = evaluateEntry({
    carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110,
    activityContext: { todaySteps: 8500, avgSteps7d: 8000, sampleSize7d: 7 },
  });
  expect(out.messages.some(m => m.key === "engine_ctx_high_activity")).toBe(false);
});
