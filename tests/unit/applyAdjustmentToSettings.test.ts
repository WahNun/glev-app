// Persistence-layer coverage for `applyAdjustmentToSettings` in
// `lib/userSettings.ts`. Task #190's done criteria explicitly call out:
//
//   * Apply writes the new ICR/CF to the user_settings row.
//   * Apply appends a record per changed field to adjustment_history.
//   * Idempotent on double-tap — the same suggestion against the
//     now-applied row must NOT append a duplicate row.
//
// Mocking strategy: `lib/supabase.ts` lazily reads its singleton from
// `globalThis._supabase`. The sibling `_fake-supabase` module sets that
// global at evaluation time. ES imports execute in source order, so
// importing the fake first guarantees the real Supabase client never
// gets constructed during this run.

import {
  TEST_USER_ID,
  setStoredRow,
  getStoredRow,
  getLastUpsert,
  clearLastUpsert,
} from "./_fake-supabase";

import { test, expect } from "@playwright/test";
import { applyAdjustmentToSettings } from "@/lib/userSettings";
import type { AdjustmentSuggestion } from "@/lib/engine/adjustment";
import type { Pattern } from "@/lib/engine/patterns";

function pattern(): Pattern {
  return {
    type: "overdosing",
    label: "Frequent over-dosing",
    explanation: "",
    confidence: "high",
    sampleSize: 8,
    counts: { good: 1, underdose: 6, overdose: 1, spike: 0 },
  };
}

function suggestion(fromIcr: number, toIcr: number, fromCf: number, toCf: number): AdjustmentSuggestion {
  return {
    hasSuggestion: true,
    pattern: pattern(),
    fromIcr, toIcr,
    fromCf,  toCf,
    message: { key: "engine_msg_overdosing", params: { fromIcr, toIcr, fromCf, toCf } },
  };
}

test.beforeEach(() => {
  setStoredRow({
    user_id: TEST_USER_ID,
    icr_g_per_unit: 10,
    cf_mgdl_per_unit: 50,
    adjustment_history: [],
  });
  clearLastUpsert();
});

test("applyAdjustmentToSettings writes new ICR/CF and appends two history rows", async () => {
  const sug = suggestion(10, 11, 50, 55);

  const history = await applyAdjustmentToSettings(sug);

  const upsert = getLastUpsert();
  expect(upsert).not.toBeNull();
  expect(upsert!.user_id).toBe(TEST_USER_ID);
  expect(upsert!.icr_g_per_unit).toBe(11);
  expect(upsert!.cf_mgdl_per_unit).toBe(55);

  expect(history).toHaveLength(2);
  expect(history.map((r) => r.field).sort()).toEqual(["correctionFactor", "icr"]);
  for (const rec of history) {
    expect(rec.reason).toBe("Frequent over-dosing");
    expect(typeof rec.at).toBe("string");
  }
});

test("applyAdjustmentToSettings is idempotent on double-tap", async () => {
  const sug = suggestion(10, 11, 50, 55);

  const first = await applyAdjustmentToSettings(sug);
  expect(first).toHaveLength(2);
  const upsertAfterFirst = getLastUpsert();
  clearLastUpsert();

  // Second tap with the same suggestion — values now already match,
  // helper must short-circuit without calling upsert again.
  const second = await applyAdjustmentToSettings(sug);
  expect(second).toHaveLength(2);
  expect(getLastUpsert()).toBeNull();

  const stored = getStoredRow()!;
  expect(stored.adjustment_history).toHaveLength(2);
  expect(stored.icr_g_per_unit).toBe(upsertAfterFirst!.icr_g_per_unit);
  expect(stored.cf_mgdl_per_unit).toBe(upsertAfterFirst!.cf_mgdl_per_unit);
});

test("applyAdjustmentToSettings clamps out-of-range ICR / CF before writing", async () => {
  // Suggestion proposes values outside the column CHECK ranges
  // (icr 1..100, cf 1..500). Helper must clamp before upsert so the
  // DB constraint never trips.
  const sug = suggestion(10, 999, 50, 9999);

  await applyAdjustmentToSettings(sug);

  const upsert = getLastUpsert()!;
  expect(upsert.icr_g_per_unit).toBe(100);
  expect(upsert.cf_mgdl_per_unit).toBe(500);
});
