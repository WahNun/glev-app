import type { InsulinLog } from "../insulin";
import type { ExerciseLog } from "../exercise";
import type { AdjustmentMessage } from "./adjustment";
import type { TrendClass } from "./trend";
import type { ActivityContext } from "@/lib/dailyActivity";
import { parseDbTs } from "@/lib/time";
import { getInsulinSettings, type InsulinSettings } from "@/lib/userSettings";
import { getEffectiveICR } from "@/lib/icrSchedule";

// Task #183: shared "high activity day" thresholds. Re-used by the
// pure annotation helper in `lib/exerciseEval.ts` so a single source
// of truth governs both the evaluator's context message and the
// pattern-recognition surface — change in one place, change in both.
export const HIGH_ACTIVITY_RATIO = 1.3;
export const HIGH_ACTIVITY_MIN_ABS = 8000;
export const HIGH_ACTIVITY_MIN_SAMPLE = 3;

export type Outcome = "GOOD" | "UNDERDOSE" | "OVERDOSE" | "SPIKE" | "SPIKE_STRONG" | "HYPO_DURING" | "CHECK_CONTEXT";

/**
 * Speed-based spike detection (Task #251 / Diagnose Case C).
 *
 * `speed1` / `speed2` are the average mg/dL/min slopes computed in
 * `lifecycleFor` (delta1/60 and delta2/120). Until #251 they were only
 * rendered as begleitender Text — a meal with a kurz heftigen Anstieg
 * that was already abgebaut bis zur 2h-Messung looked like "GOOD"
 * because |Δ_2h| stayed under the cutoff.
 *
 * The thresholds below promote the slope to a first-class SPIKE
 * trigger. They were calibrated against the existing class-cutoffs
 * (BALANCED 55 mg/dL → ~0.46 mg/dL/min over 2h, FAST_CARBS 70 mg/dL
 * → ~1.17 mg/dL/min over 1h) so a speed alone above 1.5 mg/dL/min
 * is already steeper than every class-cutoff:
 *
 *   1.5 mg/dL/min  ≈ 90 mg/dL pro Stunde   →  SPIKE
 *   2.5 mg/dL/min  ≈ 150 mg/dL pro Stunde  →  SPIKE_STRONG
 *
 * Magnitude-based detections (peakRise / Δ_2h) additionally upgrade
 * to SPIKE_STRONG when above SPIKE_STRONG_MAGNITUDE_MULTIPLIER × cutoff.
 */
export const SPEED_SPIKE_MGDL_PER_MIN          = 1.5;
export const SPEED_SPIKE_STRONG_MGDL_PER_MIN   = 2.5;
export const SPIKE_STRONG_MAGNITUDE_MULTIPLIER = 1.5;

/** Hypo threshold shared by all evaluation paths (sparse-bg, curve min, hadHypoWindow). */
export const HYPO_THRESHOLD = 70;

/** Per-class spike cutoffs (mg/dL BG rise). Referenced by check-engine-doc-thresholds. */
export const SPIKE_CUTOFF_FAST_CARBS   = 70;
export const SPIKE_CUTOFF_HIGH_FAT     = 40;
export const SPIKE_CUTOFF_HIGH_PROTEIN = 50;
export const SPIKE_CUTOFF_BALANCED     = 55;

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
   * Task #183: optional Apple-Health daily-step context. Surfaces as a
   * standalone "high activity today" reasoning entry alongside the
   * existing exercise log message. Outcome math (`Outcome`, `delta`,
   * `confidence`) is **not** affected — compliance-required: dose
   * decisions never flow from passive step counts.
   */
  activityContext?: ActivityContext | null;
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
  /**
   * Pre-Meal-CGM-Trend (Task #195): Klassifikation aus den letzten
   * ~15 min vor `meal_time`. Wenn gesetzt, hängt der Evaluator einen
   * Trend-Hinweis ans Reasoning, ändert aber das Outcome NICHT — die
   * Trend-Lage ist strikt Doku/Erklärung.
   */
  preTrend?: TrendClass;
  /**
   * Optional meal timestamp — when set, the ratio path looks up a
   * time-banded ICR via `getEffectiveICR(mealTime, settings.icr)`
   * (Phase B of Matildav's per-window ICR feature). When omitted or
   * when the user has the schedule master-toggle off, falls back to
   * `settings.icr` so behaviour is unchanged for callers that don't
   * pass a time.
   */
  mealTime?: Date | null;
}

export interface EvaluateEntryResult {
  outcome: Outcome;
  /** Localizable reasoning — render each entry with `t(m.key, m.params)`. */
  messages: AdjustmentMessage[];
  confidence: "high" | "medium" | "low";
  delta: number | null;
  netCarbs: number;
  /** Plain-text English/German summary for developer tooling and unit tests.
   *  Do NOT use for user-facing UI — use `messages` + `t()` instead. */
  reasoning: string;
}

function classKey(cls: Classification): string {
  switch (cls) {
    case "FAST_CARBS":   return "engine_class_fast_carbs";
    case "HIGH_PROTEIN": return "engine_class_high_protein";
    case "HIGH_FAT":     return "engine_class_high_fat";
    default:             return "engine_class_balanced";
  }
}

/** Pure predicate — true when the daily-steps signal crosses the
 *  shared "noteworthy active day" thresholds. Exported so other
 *  surfaces (Insights cards, pattern recognition) reuse the same gate
 *  instead of redefining the cutoffs. */
export function isHighActivityDay(ctx: ActivityContext | null | undefined): boolean {
  if (!ctx) return false;
  if (ctx.todaySteps == null || ctx.avgSteps7d == null) return false;
  if (ctx.sampleSize7d < HIGH_ACTIVITY_MIN_SAMPLE) return false;
  if (ctx.todaySteps < HIGH_ACTIVITY_MIN_ABS) return false;
  return ctx.todaySteps >= Math.round(ctx.avgSteps7d * HIGH_ACTIVITY_RATIO);
}

function contextMessages(
  insulinLogs: InsulinLog[] = [],
  exerciseLogs: ExerciseLog[] = [],
  activity?: ActivityContext | null,
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

  // Task #183: passive-activity context. Emitted independently of the
  // active-workout message above — a high step day with no explicit
  // workout still meaningfully shifts insulin sensitivity.
  if (isHighActivityDay(activity)) {
    out.push({
      key: "engine_ctx_high_activity",
      params: {
        steps: activity!.todaySteps!,
        avg: activity!.avgSteps7d!,
      },
    });
  }

  return out;
}

function trendMessages(preTrend?: TrendClass): AdjustmentMessage[] {
  if (!preTrend) return [];
  return [{ key: `engine_eval_trend_${preTrend}` }];
}

function classReasoning(cls: Classification): string {
  if (cls === "FAST_CARBS")   return "fast-carb meals";
  if (cls === "HIGH_FAT")     return "high-fat meals";
  if (cls === "HIGH_PROTEIN") return "high-protein meals";
  return "balanced meals";
}

function speedReasoning(speed1?: number | null, speed2?: number | null): string {
  const parts: string[] = [];
  if (speed1 != null && Number.isFinite(speed1)) {
    const s = `${speed1 >= 0 ? "+" : ""}${speed1.toFixed(2)}`;
    parts.push(speed1 >= 0
      ? `BG rose at ${s} mg/dL/min in the first hour.`
      : `BG fell at ${s} mg/dL/min in the first hour.`);
  }
  if (speed2 != null && Number.isFinite(speed2)) {
    const s = `${speed2 >= 0 ? "+" : ""}${speed2.toFixed(2)}`;
    parts.push(speed2 >= 0
      ? `BG rose at ${s} mg/dL/min over the 2-hour window.`
      : `BG fell at ${s} mg/dL/min over the 2-hour window.`);
  }
  return parts.join(" ");
}

function contextReasoning(
  insulinLogs: InsulinLog[] = [],
  exerciseLogs: ExerciseLog[] = [],
): string {
  const now = Date.now();
  const dayAgo = now - 24 * 3600_000;
  const fourHoursAgo = now - 4 * 3600_000;
  const parts: string[] = [];
  const recentBasal = insulinLogs.find(l =>
    l.insulin_type === "basal" && parseDbTs(l.created_at) >= dayAgo,
  );
  if (recentBasal) {
    const h = Math.max(0, Math.round((now - parseDbTs(recentBasal.created_at)) / 3600_000));
    parts.push(`Basal-Kontext: ${recentBasal.units}u ${recentBasal.insulin_name ?? ""} vor ${h}h`.trimEnd());
  }
  const recentExercise = exerciseLogs.find(l =>
    parseDbTs(l.created_at) >= fourHoursAgo,
  );
  if (recentExercise) {
    parts.push(`Bewegung: ${recentExercise.duration_minutes} min ${recentExercise.exercise_type} (${recentExercise.intensity}) in den letzten 4h`);
  }
  return parts.join(" ");
}

interface SpikeDetection {
  outcome: "SPIKE" | "SPIKE_STRONG";
  primary: AdjustmentMessage;
}

/**
 * Unified spike detector — combines magnitude (peakRise via curve OR
 * bg_2h-Δ) and slope (`speed1`/`speed2`) into one decision so a steep
 * brief Anstieg, der bis zur 2h-Messung wieder abgebaut ist, no longer
 * rutscht durch als GOOD (Diagnose Case C).
 *
 * Returns `null` when no spike signal fires. Picks the most informative
 * primary message (peak > delta > speed) so the user sees the concrete
 * mg/dL number when available, and falls back to the slope description
 * when only the speed crossed its threshold.
 */
function detectSpike(args: {
  classKey: string;
  spikeCutoff: number;
  peakRise: number | null;
  peakAtMin: number | null;
  delta: number | null;
  speed1: number | null | undefined;
  speed2: number | null | undefined;
}): SpikeDetection | null {
  const { classKey: cKey, spikeCutoff, peakRise, peakAtMin, delta, speed1, speed2 } = args;

  const peakSpike  = peakRise != null && peakRise > spikeCutoff;
  const deltaSpike = delta    != null && delta    > spikeCutoff;

  // Only positive slopes count as a spike trigger — a negative speed1
  // means BG was falling, not spiking.
  const s1Rise = speed1 != null && Number.isFinite(speed1) && speed1 > 0 ? speed1 : 0;
  const s2Rise = speed2 != null && Number.isFinite(speed2) && speed2 > 0 ? speed2 : 0;
  const speedTrigger =
    s1Rise >= SPEED_SPIKE_MGDL_PER_MIN || s2Rise >= SPEED_SPIKE_MGDL_PER_MIN;

  if (!peakSpike && !deltaSpike && !speedTrigger) return null;

  const strongMagnitude =
    (peakRise != null && peakRise > spikeCutoff * SPIKE_STRONG_MAGNITUDE_MULTIPLIER) ||
    (delta    != null && delta    > spikeCutoff * SPIKE_STRONG_MAGNITUDE_MULTIPLIER);
  const strongSpeed =
    s1Rise >= SPEED_SPIKE_STRONG_MGDL_PER_MIN ||
    s2Rise >= SPEED_SPIKE_STRONG_MGDL_PER_MIN;

  const outcome: "SPIKE" | "SPIKE_STRONG" =
    strongMagnitude || strongSpeed ? "SPIKE_STRONG" : "SPIKE";

  let primary: AdjustmentMessage;
  if (peakSpike) {
    primary = {
      key: "engine_eval_spike_peak",
      params: {
        rise: peakRise!,
        peakAt: peakAtMin ?? "?",
        threshold: spikeCutoff,
        classKey: cKey,
      },
    };
  } else if (deltaSpike) {
    primary = {
      key: "engine_eval_spike",
      params: { delta: delta!, threshold: spikeCutoff, classKey: cKey },
    };
  } else {
    // Speed-only trigger — surface the dominant slope and threshold.
    const dominant = s1Rise >= s2Rise ? s1Rise : s2Rise;
    const window: "1h" | "2h" = s1Rise >= s2Rise ? "1h" : "2h";
    primary = {
      key: "engine_eval_spike_speed",
      params: {
        speed: `+${dominant.toFixed(2)}`,
        threshold: SPEED_SPIKE_MGDL_PER_MIN.toFixed(1),
        window,
        classKey: cKey,
      },
    };
  }

  return { outcome, primary };
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
    cls === "FAST_CARBS"   ? SPIKE_CUTOFF_FAST_CARBS   :
    cls === "HIGH_FAT"     ? SPIKE_CUTOFF_HIGH_FAT      :
    cls === "HIGH_PROTEIN" ? SPIKE_CUTOFF_HIGH_PROTEIN  :
    SPIKE_CUTOFF_BALANCED;

  // Curve-aware + sparse-hypo decisions. A meal must NEVER be labelled
  // GOOD if any post-meal BG (bg_1h, bg_2h, or the 0–180 min curve
  // minimum) dipped below the hypo threshold.
  //
  // Two paths cover this:
  //   • Curve path (Task #187): `hadHypoWindow === true` OR a populated
  //     `minBg180 < HYPO_THRESHOLD` — detects a hypo that happened
  //     BETWEEN the bg_1h / bg_2h snapshots.
  //   • Sparse path (Task #249): the single post-meal point we *do* have
  //     (`bgAfter`, fed by lifecycle as bg_2h or bg_1h) is itself below
  //     the threshold. Without this guard, e.g. 110 → 60 mg/dL would
  //     fall into the Δ-block and be labelled OVERDOSE while the meal
  //     is plainly in HYPO territory; or 100 → (mid 60) → 100 leaks
  //     into "GOOD" because the in-between dip is invisible.
  const sparseHypoBg =
    bgAfter != null && bgAfter < HYPO_THRESHOLD;
  const curveHypo =
    input.hadHypoWindow === true ||
    (input.minBg180 != null && input.minBg180 < HYPO_THRESHOLD);
  if ((curveHypo || sparseHypoBg) && bgBefore != null) {
    // Prefer the curve minimum when known; otherwise fall back to the
    // sparse post-meal point that triggered the guard.
    const minBg =
      input.minBg180 != null ? Math.round(input.minBg180)
      : sparseHypoBg          ? Math.round(bgAfter as number)
      : null;
    const messages: AdjustmentMessage[] = [
      { key: "engine_eval_hypo_during", params: { minBg: minBg ?? "<70" } },
      ...speedMessages(input.speed1, input.speed2),
      ...contextMessages(input.recentInsulinLogs, input.recentExerciseLogs, input.activityContext),
      ...trendMessages(input.preTrend),
    ];
    return { outcome: "HYPO_DURING", messages, confidence: "high", delta, netCarbs,
      reasoning: `HYPO_DURING — BG dipped below 70 mg/dL post-meal. ${speedReasoning(input.speed1, input.speed2)} ${contextReasoning(input.recentInsulinLogs, input.recentExerciseLogs)}`.trim() };
  }

  // Unified spike detection (Task #251): combines peakRise + Δ_2h + slope.
  // Runs BEFORE the delta-based GOOD/UNDER/OVER triage so a steep brief
  // Anstieg, der bis zur 2h-Messung wieder abgebaut ist (|Δ_2h| ≤ 30,
  // aber speed1 > 1.5 mg/dL/min), no longer rutscht durch als GOOD.
  const spike = detectSpike({
    classKey: classKey(cls),
    spikeCutoff,
    peakRise: input.maxBg180 != null && bgBefore != null
      ? Math.round(input.maxBg180 - bgBefore)
      : null,
    peakAtMin: input.timeToPeakMin ?? null,
    delta,
    speed1: input.speed1,
    speed2: input.speed2,
  });
  if (spike) {
    const messages: AdjustmentMessage[] = [
      spike.primary,
      ...speedMessages(input.speed1, input.speed2),
      ...contextMessages(input.recentInsulinLogs, input.recentExerciseLogs, input.activityContext),
      ...trendMessages(input.preTrend),
    ];
    // Magnitude-backed spikes (peak or Δ_2h known) → high confidence.
    // Speed-only triggers without any post-meal magnitude → medium.
    const hasMagnitudeSignal =
      (input.maxBg180 != null && bgBefore != null) || delta != null;
    return {
      outcome: spike.outcome,
      messages,
      confidence: hasMagnitudeSignal ? "high" : "medium",
      delta,
      netCarbs,
      reasoning: `BG spiked — above threshold for ${classReasoning(cls)}. ${speedReasoning(input.speed1, input.speed2)} ${contextReasoning(input.recentInsulinLogs, input.recentExerciseLogs)}`.trim(),
    };
  }

  if (delta != null) {
    let outcome: Outcome;
    let primary: AdjustmentMessage;
    if (delta > 30) {
      outcome = "UNDERDOSE";
      primary = { key: "engine_eval_underdose", params: { delta } };
    } else if (delta < -30) {
      outcome = "OVERDOSE";
      primary = { key: "engine_eval_overdose", params: { delta: Math.abs(delta) } };
    } else {
      outcome = "GOOD";
      primary = {
        // Task #250 — when no insulin was given we must not claim
        // "Insulin-Dosis hat zur Kohlenhydratlast gepasst". Swap to a
        // neutral variant that just describes the trajectory.
        key: insulin > 0 ? "engine_eval_good" : "engine_eval_good_no_insulin",
        params: { delta: `${delta > 0 ? "+" : ""}${delta}` },
      };
    }
    const confidence: EvaluateEntryResult["confidence"] =
      Math.abs(delta) > 80 ? "high" : Math.abs(delta) > 25 ? "medium" : "high";
    const messages: AdjustmentMessage[] = [
      primary,
      ...speedMessages(input.speed1, input.speed2),
      ...contextMessages(input.recentInsulinLogs, input.recentExerciseLogs, input.activityContext),
      ...trendMessages(input.preTrend),
    ];
    const reasoning = `Δ${delta > 0 ? "+" : ""}${delta} mg/dL — ${outcome === "GOOD" ? "dose matched" : outcome.toLowerCase()}. ${speedReasoning(input.speed1, input.speed2)} ${contextReasoning(input.recentInsulinLogs, input.recentExerciseLogs)}`.trim();
    return { outcome, messages, confidence, delta, netCarbs, reasoning };
  }

  // No bgAfter: fallback ICR-ratio heuristic using personal settings.
  // Task #250 — short-circuit when no insulin was given. The ratio path
  // would mechanically yield UNDERDOSE (ratio = 0/expected), but calling
  // a meal with zero bolus an "Unter-Dosis" makes no sense and the
  // matching `engine_eval_icr_*` strings all describe the dose. Return
  // a neutral GOOD with a no-insulin/no-data note instead.
  if (insulin <= 0) {
    const messages: AdjustmentMessage[] = [
      { key: "engine_eval_no_insulin_no_data" },
      ...speedMessages(input.speed1, input.speed2),
      ...contextMessages(input.recentInsulinLogs, input.recentExerciseLogs, input.activityContext),
      ...trendMessages(input.preTrend),
    ];
    return { outcome: "GOOD", messages, confidence: "low", delta: null, netCarbs,
      reasoning: `No insulin logged — no dose evaluation. ${speedReasoning(input.speed1, input.speed2)} ${contextReasoning(input.recentInsulinLogs, input.recentExerciseLogs)}`.trim() };
  }
  // Phase B (Matildav window-ICR): when a meal time is supplied AND
  // the user has the schedule master toggle on with an active window
  // at that time, grade the dose against the window's ICR instead of
  // the global one. Falls through to settings.icr otherwise.
  const effective = input.mealTime
    ? getEffectiveICR(input.mealTime, settings.icr)
    : { icr: settings.icr, slot: null };
  let expected = netCarbs / effective.icr;
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
    ...contextMessages(input.recentInsulinLogs, input.recentExerciseLogs, input.activityContext),
    ...trendMessages(input.preTrend),
  ];
  const icrPrimary = outcome === "GOOD" ? "Dose within ICR-expected range."
    : outcome === "OVERDOSE" ? "ICR-ratio overdose." : "ICR-ratio underdose.";
  const reasoning = `${icrPrimary} ${speedReasoning(input.speed1, input.speed2)} ${contextReasoning(input.recentInsulinLogs, input.recentExerciseLogs)}`.trim();
  return { outcome, messages, confidence: "low", delta: null, netCarbs, reasoning };
}
