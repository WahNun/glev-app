// Unit coverage for `computeSymStats` in `lib/insights/symStats.ts`.
//
// Pins the key invariants of the symStats accumulation loop that powers
// the "Top 3 Symptoms" widget on the Insights page:
//
//   1. Null cgm_glucose_at_log entries are excluded from the running sum.
//   2. Mixed null/non-null rows: only non-null values count toward the avg.
//   3. All-null glucose → avgGlucose === null (no division by zero).
//   4. avgGlucose is rounded to the nearest integer via Math.round.
//   5. Rows outside the time window are skipped entirely.
//   6. Sorting: symptoms are returned ordered by descending occurrence count.
//   7. topN cap: only the top-N entries are returned (default 3).
//
// Runs as a Playwright unit test (no browser, no dev server) — same
// convention as tests/unit/evaluation.test.ts.

import { test, expect } from "@playwright/test";
import { computeSymStats } from "@/lib/insights/symStats";

const WIN_START = Date.parse("2026-04-01T00:00:00Z");
const WIN_END   = Date.parse("2026-05-01T00:00:00Z");

function log(
  occurred_at: string,
  symptoms: string[],
  glucose: number | null,
  severities: Record<string, number> = {},
) {
  return {
    occurred_at,
    symptom_types: symptoms as never,
    cgm_glucose_at_log: glucose,
    severities: severities as never,
  };
}

// ── 1. All-null glucose → avgGlucose null ───────────────────────────────────

test("all-null glucose entries → avgGlucose is null", () => {
  const logs = [
    log("2026-04-10T08:00:00Z", ["headache"], null, { headache: 3 }),
    log("2026-04-11T08:00:00Z", ["headache"], null, { headache: 4 }),
  ];
  const result = computeSymStats(logs, WIN_START, WIN_END);
  expect(result).toHaveLength(1);
  expect(result[0].key).toBe("headache");
  expect(result[0].avgGlucose).toBeNull();
});

// ── 2. Null entries excluded from running sum ────────────────────────────────

test("null entries are excluded; non-null value drives avgGlucose", () => {
  const logs = [
    log("2026-04-10T08:00:00Z", ["fatigue"], null,  { fatigue: 3 }),
    log("2026-04-11T08:00:00Z", ["fatigue"], 120,   { fatigue: 3 }),
    log("2026-04-12T08:00:00Z", ["fatigue"], null,  { fatigue: 3 }),
  ];
  const result = computeSymStats(logs, WIN_START, WIN_END);
  expect(result[0].avgGlucose).toBe(120);
});

// ── 3. Mixed null/non-null: average over non-null only ──────────────────────

test("mixed null/non-null: averages only the non-null readings", () => {
  const logs = [
    log("2026-04-10T08:00:00Z", ["cramps"], 100, { cramps: 3 }),
    log("2026-04-11T08:00:00Z", ["cramps"], null, { cramps: 3 }),
    log("2026-04-12T08:00:00Z", ["cramps"], 200, { cramps: 3 }),
  ];
  const result = computeSymStats(logs, WIN_START, WIN_END);
  expect(result[0].avgGlucose).toBe(150);
});

// ── 4. Rounding to nearest integer ──────────────────────────────────────────

test("avgGlucose is rounded to the nearest integer", () => {
  const logs = [
    log("2026-04-10T08:00:00Z", ["nausea"], 100, { nausea: 3 }),
    log("2026-04-11T08:00:00Z", ["nausea"], 101, { nausea: 3 }),
    log("2026-04-12T08:00:00Z", ["nausea"], 102, { nausea: 3 }),
  ];
  // sum = 303, count = 3 → 101 (exact, no rounding needed)
  const result = computeSymStats(logs, WIN_START, WIN_END);
  expect(result[0].avgGlucose).toBe(101);
});

test("avgGlucose rounds 0.5 upward", () => {
  const logs = [
    log("2026-04-10T08:00:00Z", ["bloating"], 100, { bloating: 3 }),
    log("2026-04-11T08:00:00Z", ["bloating"], 101, { bloating: 3 }),
  ];
  // (100 + 101) / 2 = 100.5 → Math.round → 101
  const result = computeSymStats(logs, WIN_START, WIN_END);
  expect(result[0].avgGlucose).toBe(101);
});

test("avgGlucose rounds down when fraction < 0.5", () => {
  const logs = [
    log("2026-04-10T08:00:00Z", ["anxiety"], 100, { anxiety: 3 }),
    log("2026-04-11T08:00:00Z", ["anxiety"], 100, { anxiety: 3 }),
    log("2026-04-12T08:00:00Z", ["anxiety"], 101, { anxiety: 3 }),
  ];
  // (100 + 100 + 101) / 3 = 100.333… → Math.round → 100
  const result = computeSymStats(logs, WIN_START, WIN_END);
  expect(result[0].avgGlucose).toBe(100);
});

// ── 5. Window filtering ──────────────────────────────────────────────────────

test("rows outside the window are excluded entirely", () => {
  const logs = [
    log("2026-03-31T23:59:59Z", ["headache"], 180, { headache: 3 }), // before window
    log("2026-04-10T08:00:00Z", ["headache"], 120, { headache: 3 }), // inside
    log("2026-05-01T00:00:00Z", ["headache"], 200, { headache: 3 }), // at window end — excluded
  ];
  const result = computeSymStats(logs, WIN_START, WIN_END);
  expect(result[0].count).toBe(1);
  expect(result[0].avgGlucose).toBe(120);
});

test("empty result when all rows are outside the window", () => {
  const logs = [
    log("2026-03-15T08:00:00Z", ["fatigue"], 100, { fatigue: 3 }),
  ];
  const result = computeSymStats(logs, WIN_START, WIN_END);
  expect(result).toHaveLength(0);
});

// ── 6. Sorting by descending count ──────────────────────────────────────────

test("symptoms are returned sorted by descending occurrence count", () => {
  const logs = [
    log("2026-04-01T08:00:00Z", ["headache"], null, { headache: 3 }),
    log("2026-04-02T08:00:00Z", ["fatigue"],  null, { fatigue: 3 }),
    log("2026-04-03T08:00:00Z", ["fatigue"],  null, { fatigue: 3 }),
    log("2026-04-04T08:00:00Z", ["fatigue"],  null, { fatigue: 3 }),
    log("2026-04-05T08:00:00Z", ["headache"], null, { headache: 3 }),
  ];
  const result = computeSymStats(logs, WIN_START, WIN_END, 5);
  expect(result[0].key).toBe("fatigue");
  expect(result[0].count).toBe(3);
  expect(result[1].key).toBe("headache");
  expect(result[1].count).toBe(2);
});

// ── 7. topN cap ─────────────────────────────────────────────────────────────

test("only topN symptoms are returned", () => {
  const logs = [
    log("2026-04-01T08:00:00Z", ["headache", "fatigue", "cramps", "nausea"], null, {}),
  ];
  const result3 = computeSymStats(logs, WIN_START, WIN_END, 3);
  expect(result3).toHaveLength(3);

  const result1 = computeSymStats(logs, WIN_START, WIN_END, 1);
  expect(result1).toHaveLength(1);
});

// ── 8. Single entry with glucose produces correct count and avg ──────────────

test("single entry with glucose: count=1 and avgGlucose equals that value", () => {
  const logs = [
    log("2026-04-15T12:00:00Z", ["dizziness"], 142, { dizziness: 4 }),
  ];
  const result = computeSymStats(logs, WIN_START, WIN_END);
  expect(result[0].count).toBe(1);
  expect(result[0].avgGlucose).toBe(142);
});

// ── 9. Multiple symptoms in a single log row ─────────────────────────────────

test("one log row with two symptoms contributes to both symptom buckets", () => {
  const logs = [
    log("2026-04-10T08:00:00Z", ["headache", "fatigue"], 110, {
      headache: 3,
      fatigue: 2,
    }),
  ];
  const result = computeSymStats(logs, WIN_START, WIN_END, 5);
  const headache = result.find((r) => r.key === "headache");
  const fatigue  = result.find((r) => r.key === "fatigue");
  expect(headache?.count).toBe(1);
  expect(headache?.avgGlucose).toBe(110);
  expect(fatigue?.count).toBe(1);
  expect(fatigue?.avgGlucose).toBe(110);
});

// ── 10. Empty logs array ─────────────────────────────────────────────────────

test("empty logs array returns an empty result", () => {
  const result = computeSymStats([], WIN_START, WIN_END);
  expect(result).toHaveLength(0);
});
