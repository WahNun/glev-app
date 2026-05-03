import type { InsulinLog } from "../insulin";
import type { ExerciseLog } from "../exercise";
import type { AdjustmentMessage } from "./adjustment";
import { parseDbTs } from "@/lib/time";
import { getInsulinSettings, type InsulinSettings } from "@/lib/userSettings";

export type Outcome = "GOOD" | "UNDERDOSE" | "OVERDOSE" | "SPIKE" | "HYPO_DURING" | "CHECK_CONTEXT";

export type Classification = "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED" | null | undefined;

export interface EvaluateEntryInput {
  carbs: number;
  protein?: number;
  fat?: number;
  fiber?: number;
  insulin: number;
  bgBefore: number | null;
  bgAfter?: number | null;
  classification?: Classification;
  speed1?: number | null;
  speed2?: number | null;
  recentInsulinLogs?: InsulinLog[];
  recentExerciseLogs?: ExerciseLog[];
  /**
   * Window-level aggregates from the per-meal CGM curve
   * (`meal_glucose_samples`, Task #187). When provided, the evaluator
   * switches to curve-aware decisions:
   *   • `hadHypoWindow === true`        → HYPO_DURING wins
   *   • `maxBg180 - bgBefore > spike`   → SPIKE (peak-based instead of
   *                                         the legacy bg_2h-Δ check)
   * Falls back to the bg_2h-delta path when not supplied (older meals
   * that pre-date the +3h backfill job).
   */
  minBg180?: number | null;
  maxBg180?: number | null;
  timeToPeakMin?: number | null;
  hadHypoWindow?: boolean | null;
  /**
   * Personal insulin parameters (ICR / CF / target BG). When omitted,
   * we fall back to getInsulinSettings() — which reads localStorage on
   * the client and returns sensible defaults (15/50/110) on the server
   * with a one-time console warning. Pass an explicit value to bypass
   * the fallback (e.g. server-side recompute paths).
   */
  settings?: InsulinSettings;
}

export interface EvaluateEntryResult {
  outcome: Outcome;
  /** Localizable reasoning — render each entry with `t(m.key, m.params)`. */
  messages: AdjustmentMessage[];
  confidence: "high" | "medium" | "low";
  delta: number | null;
  netCarbs: number;
}

function classKey(cls: Classification): string {
  switch (cls) {
    case "FAST_CARBS":   return "engine_class_fast_carbs";
    case "HIGH_PROTEIN": return "engine_class_high_protein";
    case "HIGH_FAT":     return "engine_class_high_fat";
    default:             return "engine_class_balanced";
  }
}

function contextMessages(
  insulinLogs: InsulinLog[] = [],
  exerciseLogs: ExerciseLog[] = [],
): AdjustmentMessage[] {
  const now = Date.now();
  const dayAgo = now - 24 * 3600_000;
  const fourHoursAgo = now - 4 * 3600_000;
  const out: AdjustmentMessage[] = [];

  const recentBasal = insulinLogs.find(l =>
    l.insulin_type === "basal" && parseDbTs(l.created_at) >= dayAgo,
  );
  if (recentBasal) {
    const hoursAgo = Math.max(0, Math.round((now - parseDbTs(recentBasal.created_at)) / 3600_000));
    out.push({
      key: "engine_ctx_basal",
      params: { units: recentBasal.units, name: recentBasal.insulin_name || "", hours: hoursAgo },
    });
  }

  const recentExercise = exerciseLogs.find(l =>
    parseDbTs(l.created_at) >= fourHoursAgo,
  );
  if (recentExercise) {
    out.push({
      key: "engine_ctx_exercise",
      params: {
        minutes: recentExercise.duration_minutes,
        type: recentExercise.exercise_type,
        intensity: recentExercise.intensity,
      },
    });
  }

  return out;
}

function speedMessages(speed1?: number | null, speed2?: number | null): AdjustmentMessage[] {
  const out: AdjustmentMessage[] = [];
  if (speed1 != null && Number.isFinite(speed1)) {
    const sign = speed1 >= 0 ? "+" : "";
    out.push({
      key: speed1 >= 0 ? "engine_speed1_rose" : "engine_speed1_fell",
      params: { speed: `${sign}${speed1.toFixed(2)}` },
    });
  }
  if (speed2 != null && Number.isFinite(speed2)) {
    const sign = speed2 >= 0 ? "+" : "";
    out.push({
      key: speed2 >= 0 ? "engine_speed2_rose" : "engine_speed2_fell",
      params: { speed: `${sign}${speed2.toFixed(2)}` },
    });
  }
  return out;
}

export function evaluateEntry(input: EvaluateEntryInput): EvaluateEntryResult {
  const carbs    = Math.max(0, input.carbs || 0);
  const fiber    = Math.max(0, input.fiber || 0);
  const netCarbs = Math.max(0, carbs - fiber);
  const insulin  = Math.max(0, input.insulin || 0);
  const bgBefore = input.bgBefore ?? null;
  const bgAfter  = input.bgAfter  ?? null;
  const cls      = input.classification || "BALANCED";
  const settings = input.settings ?? getInsulinSettings();

  const delta = bgBefore != null && bgAfter != null ? bgAfter - bgBefore : null;

  const spikeCutoff =
    cls === "FAST_CARBS" ? 70 :
    cls === "HIGH_FAT"   ? 40 :
    cls === "HIGH_PROTEIN" ? 50 :
    55;

  // Curve-aware decisions (Task #187). When the +3h backfill job has
  // populated the window aggregates we can detect hypos that happened
  // BETWEEN the bg_1h / bg_2h snapshots and use the peak rise (not the
  // bg_2h-Δ) for SPIKE — both are invisible to the legacy two-point path.
  if (input.hadHypoWindow === true && bgBefore != null) {
    const minBg = input.minBg180 != null ? Math.round(input.minBg180) : null;
    const messages: AdjustmentMessage[] = [
      { key: "engine_eval_hypo_during", params: { minBg: minBg ?? "<70" } },
      ...speedMessages(input.speed1, input.speed2),
      ...contextMessages(input.recentInsulinLogs, input.recentExerciseLogs),
    ];
    return { outcome: "HYPO_DURING", messages, confidence: "high", delta, netCarbs };
  }

  if (input.maxBg180 != null && bgBefore != null) {
    const peakRise = Math.round(input.maxBg180 - bgBefore);
    if (peakRise > spikeCutoff) {
      const messages: AdjustmentMessage[] = [
        {
          key: "engine_eval_spike_peak",
          params: {
            rise: peakRise,
            peakAt: input.timeToPeakMin ?? "?",
            threshold: spikeCutoff,
            classKey: classKey(cls),
          },
        },
        ...speedMessages(input.speed1, input.speed2),
        ...contextMessages(input.recentInsulinLogs, input.recentExerciseLogs),
      ];
      return { outcome: "SPIKE", messages, confidence: "high", delta, netCarbs };
    }
  }

  if (delta != null) {
    let outcome: Outcome;
    let primary: AdjustmentMessage;
    if (delta > spikeCutoff) {
      outcome = "SPIKE";
      primary = {
        key: "engine_eval_spike",
        params: { delta, threshold: spikeCutoff, classKey: classKey(cls) },
      };
    } else if (delta > 30) {
      outcome = "UNDERDOSE";
      primary = { key: "engine_eval_underdose", params: { delta } };
    } else if (delta < -30) {
      outcome = "OVERDOSE";
      primary = { key: "engine_eval_overdose", params: { delta: Math.abs(delta) } };
    } else {
      outcome = "GOOD";
      primary = {
        key: "engine_eval_good",
        params: { delta: `${delta > 0 ? "+" : ""}${delta}` },
      };
    }
    const confidence: EvaluateEntryResult["confidence"] =
      Math.abs(delta) > 80 ? "high" : Math.abs(delta) > 25 ? "medium" : "high";
    const messages: AdjustmentMessage[] = [
      primary,
      ...speedMessages(input.speed1, input.speed2),
      ...contextMessages(input.recentInsulinLogs, input.recentExerciseLogs),
    ];
    return { outcome, messages, confidence, delta, netCarbs };
  }

  // No bgAfter: fallback ICR-ratio heuristic using personal settings.
  let expected = netCarbs / settings.icr;
  if (bgBefore && bgBefore > settings.targetBg) expected += (bgBefore - settings.targetBg) / settings.cf;
  const ratio = insulin / Math.max(expected, 0.1);

  let outcome: Outcome;
  let primary: AdjustmentMessage;
  if (ratio > 1.35) {
    outcome = "OVERDOSE";
    primary = { key: "engine_eval_icr_overdose", params: { pct: Math.round((ratio - 1) * 100) } };
  } else if (ratio < 0.65) {
    outcome = "UNDERDOSE";
    primary = { key: "engine_eval_icr_underdose", params: { pct: Math.round((1 - ratio) * 100) } };
  } else {
    outcome = "GOOD";
    primary = { key: "engine_eval_icr_good" };
  }
  const messages: AdjustmentMessage[] = [
    primary,
    ...speedMessages(input.speed1, input.speed2),
    ...contextMessages(input.recentInsulinLogs, input.recentExerciseLogs),
  ];
  return { outcome, messages, confidence: "low", delta: null, netCarbs };
}
