// Unit coverage for the Task #187 curve helpers + the new
// HYPO_DURING / peak-based SPIKE branches in the evaluator.
//
// Pure-function tests — no DB, no network, no Next handlers.

import { test, expect } from "@playwright/test";

import {
  computeDerivedCurveFields,
  pickSlotValue,
  type MealSample,
} from "@/lib/cgm/mealCurve";
import { evaluateEntry } from "@/lib/engine/evaluation";

// ── computeDerivedCurveFields ────────────────────────────────────────

test("computeDerivedCurveFields: empty samples → all-null", () => {
  const r = computeDerivedCurveFields([]);
  expect(r.min_bg_180).toBeNull();
  expect(r.max_bg_180).toBeNull();
  expect(r.had_hypo_window).toBeNull();
});

test("computeDerivedCurveFields: detects hypo, peak, AUC, min_60_180", () => {
  const samples: MealSample[] = [
    { t_offset_min:   0, value_mgdl: 110 },
    { t_offset_min:  30, value_mgdl: 180 }, // peak
    { t_offset_min:  60, value_mgdl: 140 },
    { t_offset_min:  90, value_mgdl:  90 },
    { t_offset_min: 120, value_mgdl:  68 }, // hypo
    { t_offset_min: 150, value_mgdl:  75 },
    { t_offset_min: 180, value_mgdl:  95 },
  ];
  const r = computeDerivedCurveFields(samples);
  expect(r.min_bg_180).toBe(68);
  expect(r.max_bg_180).toBe(180);
  expect(r.time_to_peak_min).toBe(30);
  expect(r.had_hypo_window).toBe(true);
  // min in [60, 180] excludes the early baseline values.
  expect(r.min_bg_60_180).toBe(68);
  // AUC > 0 — exact value doesn't matter, just sanity.
  expect((r.auc_180 ?? 0) > 0).toBe(true);
});

test("computeDerivedCurveFields: had_hypo_window=false when min ≥ 70", () => {
  const r = computeDerivedCurveFields([
    { t_offset_min: 0, value_mgdl: 100 },
    { t_offset_min: 60, value_mgdl: 130 },
    { t_offset_min: 120, value_mgdl: 110 },
  ]);
  expect(r.had_hypo_window).toBe(false);
});

// ── pickSlotValue ────────────────────────────────────────────────────

test("pickSlotValue: picks nearest sample within ±15 min", () => {
  const samples: MealSample[] = [
    { t_offset_min: 45, value_mgdl: 130 },
    { t_offset_min: 58, value_mgdl: 145 },
    { t_offset_min: 75, value_mgdl: 150 },
  ];
  const s60 = pickSlotValue(samples, 60, 15);
  expect(s60?.value_mgdl).toBe(145);
});

test("pickSlotValue: returns null when no sample inside the tolerance", () => {
  const s = pickSlotValue([{ t_offset_min: 30, value_mgdl: 100 }], 120, 15);
  expect(s).toBeNull();
});

// ── evaluator: HYPO_DURING wins ──────────────────────────────────────

test("evaluateEntry: HYPO_DURING wins over a normal-looking bg_2h", () => {
  // bg_2h is back in range (delta=5, would be GOOD), but the curve
  // captured a min_bg of 60 mg/dL between the snapshots.
  const r = evaluateEntry({
    carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 105,
    minBg180: 60, maxBg180: 130, hadHypoWindow: true,
  });
  expect(r.outcome).toBe("HYPO_DURING");
  const primary = r.messages[0];
  expect(primary.key).toBe("engine_eval_hypo_during");
  expect(primary.params?.minBg).toBe(60);
});

// ── evaluator: peak-based SPIKE ──────────────────────────────────────

test("evaluateEntry: SPIKE on max_bg − bgBefore even when bg_2h is back to baseline", () => {
  // Legacy delta path: bgAfter=105, delta=5 → GOOD.
  // Curve path: maxBg180=180, peakRise=80 > BALANCED cutoff 55 → SPIKE.
  const r = evaluateEntry({
    carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 105,
    maxBg180: 180, hadHypoWindow: false, timeToPeakMin: 45,
  });
  expect(r.outcome).toBe("SPIKE");
  const primary = r.messages[0];
  expect(primary.key).toBe("engine_eval_spike_peak");
  expect(primary.params?.rise).toBe(80);
  expect(primary.params?.peakAt).toBe(45);
});

test("evaluateEntry: peak below cutoff falls back to delta path (GOOD)", () => {
  const r = evaluateEntry({
    carbs: 50, insulin: 4, bgBefore: 100, bgAfter: 110,
    maxBg180: 140, hadHypoWindow: false,
  });
  expect(r.outcome).toBe("GOOD");
});
