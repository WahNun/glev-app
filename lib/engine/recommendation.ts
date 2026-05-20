import type { AdaptiveICR, TimeOfDay } from "./adaptiveICR";
import type { InsulinLog } from "../insulin";
import type { ExerciseLog } from "../exercise";
import type { AdjustmentMessage } from "./adjustment";
import type { TrendClass } from "./trend";
import type { ActivityContext } from "@/lib/dailyActivity";
import { parseDbTs } from "@/lib/time";
// Task #183: shared "high activity day" predicate. Lives in
// `./evaluation.ts` so this file, the per-meal evaluator, and the
// engine page's safetyNotesFromLogs all consult one definition.
import { isHighActivityDay } from "./evaluation";

export interface RecommendInput {
  carbs: number;
  currentBG: number | null;
  targetBG?: number;
  adaptiveICR: AdaptiveICR;
  correctionFactor?: number;
  timeOfDay?: TimeOfDay;
  recentInsulinLogs?: InsulinLog[];
  recentExerciseLogs?: ExerciseLog[];
  /**
   * Pre-Meal-CGM-Trend aus den letzten ~15 min vor diesem Aufruf
   * (siehe `lib/engine/trend.classifyTrend`). Wenn gesetzt, hängt die
   * Engine einen Trend-Hinweis ans Reasoning. Die Dosis-Zahl wird
   * dadurch NICHT verändert — Compliance-Vorgabe für v1, der Trend
   * ist strikt Doku/Warnung.
   */
  preTrend?: TrendClass;
  /**
   * Task #183: Apple-Health-Tagesschritte als reine Kontext-Annotation.
   * Wenn gesetzt UND deutlich überdurchschnittlich (siehe
   * HIGH_ACTIVITY_RATIO unten), hängt die Engine einen Awareness-Hinweis
   * an die Reasoning-Liste — die berechnete Dosis wird **nicht** geändert
   * (Compliance: keine direkte Dosisanweisung aus Aktivitätsdaten).
   */
  activityContext?: ActivityContext | null;
}

export interface RecommendOutput {
  recommendedUnits: number;
  carbDose: number;
  correctionDose: number;
  blocked: boolean;
  /** Localizable reasoning — render each entry with `t(m.key, m.params)`. */
  messages: AdjustmentMessage[];
  confidence: "high" | "medium" | "low";
  icrUsed: number;
  icrSource: "morning" | "afternoon" | "evening" | "global" | "default";
  /** Plain-text English/German summary for developer tooling and unit tests.
   *  Do NOT use for user-facing UI — use `messages` + `t()` instead. */
  reasoning: string;
}

export const DEFAULT_ICR    = 15;
export const DEFAULT_CF     = 50;
export const DEFAULT_TARGET = 100;
/** BG floor: below this threshold the engine blocks all dose recommendations. */
export const SAFETY_BG_MIN  = 80;
/** Hard dose ceiling: calculated totals above this value are clamped. */
export const MAX_DOSE_UNITS = 25;

function safePositive(n: number | null | undefined, fallback: number): number {
  return n != null && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function recommendDose(input: RecommendInput): RecommendOutput {
  const carbs    = Math.max(0, Number.isFinite(input.carbs) ? input.carbs : 0);
  const targetBG = safePositive(input.targetBG, DEFAULT_TARGET);
  const cf       = safePositive(input.correctionFactor, DEFAULT_CF);

  let icrUsed = DEFAULT_ICR;
  let icrSource: RecommendOutput["icrSource"] = "default";
  const a = input.adaptiveICR;
  const tod = input.timeOfDay;
  const todVal = tod ? a[tod] : null;
  if (todVal != null && Number.isFinite(todVal) && todVal > 0) {
    icrUsed = todVal; icrSource = tod as RecommendOutput["icrSource"];
  } else if (a.global != null && Number.isFinite(a.global) && a.global > 0) {
    icrUsed = a.global; icrSource = "global";
  }
  icrUsed = safePositive(icrUsed, DEFAULT_ICR);

  if (input.currentBG != null && input.currentBG < SAFETY_BG_MIN) {
    return {
      recommendedUnits: 0, carbDose: 0, correctionDose: 0,
      blocked: true,
      messages: [{ key: "engine_rec_below_safety", params: { bg: input.currentBG, floor: SAFETY_BG_MIN } }],
      confidence: "high", icrUsed, icrSource,
      reasoning: `BG at ${input.currentBG} mg/dL — below safety floor of ${SAFETY_BG_MIN} mg/dL. No dose recommended.`,
    };
  }

  const carbDose = carbs > 0 ? carbs / icrUsed : 0;
  const correctionDose = input.currentBG != null && input.currentBG > targetBG
    ? (input.currentBG - targetBG) / cf
    : 0;
  const totalRaw = Math.max(0, carbDose + correctionDose);
  const clamped  = totalRaw > MAX_DOSE_UNITS;
  const total    = clamped ? MAX_DOSE_UNITS : totalRaw;

  const confidence: RecommendOutput["confidence"] =
    icrSource === "default" ? "low" :
    a.sampleSize >= 10 ? "high" :
    a.sampleSize >= 5  ? "medium" : "low";

  const messages: AdjustmentMessage[] = [];
  if (carbs > 0) {
    messages.push({
      key: "engine_rec_carb_dose",
      params: { carbs, icr: icrUsed.toFixed(1), source: icrSource, dose: carbDose.toFixed(2) },
    });
  }
  if (correctionDose > 0 && input.currentBG != null) {
    messages.push({
      key: "engine_rec_correction",
      params: { bg: input.currentBG, target: targetBG, cf, dose: correctionDose.toFixed(2) },
    });
  }
  if (messages.length === 0) {
    messages.push({ key: "engine_rec_no_dose" });
  }
  if (clamped) {
    messages.push({ key: "engine_rec_clamped", params: { max: MAX_DOSE_UNITS } });
  }

  // Pre-Meal-Trend-Annotation (Task #195). Strikt Doku — die Dosis
  // bleibt unangetastet. Bei `rising_fast` knapp über dem Ziel-BG
  // gibt's zusätzlich einen Overshoot-Hinweis: wenn die Glukose sich
  // gleich von selbst senkt, könnte die Korrektur überschießen.
  if (input.preTrend) {
    messages.push({ key: `engine_rec_trend_${input.preTrend}` });
    if (
      input.preTrend === "rising_fast" &&
      input.currentBG != null &&
      input.currentBG > targetBG &&
      input.currentBG - targetBG <= 40
    ) {
      messages.push({ key: "engine_rec_trend_overshoot_warn" });
    }
  }

  const nowMs = Date.now();
  const sixHoursAgo = nowMs - 6 * 3600_000;
  const oneDayAgo   = nowMs - 24 * 3600_000;

  const recentBolusCount = (input.recentInsulinLogs ?? [])
    .filter(l => l.insulin_type === "bolus" && parseDbTs(l.created_at) >= sixHoursAgo)
    .length;
  if (recentBolusCount > 2) {
    messages.push({ key: "engine_rec_stacking", params: { count: recentBolusCount } });
  }

  const lastBasal = (input.recentInsulinLogs ?? [])
    .filter(l => l.insulin_type === "basal" && parseDbTs(l.created_at) >= oneDayAgo)
    .sort((x, y) => parseDbTs(y.created_at) - parseDbTs(x.created_at))[0];
  if (lastBasal) {
    const hAgo = Math.max(0, Math.round((nowMs - parseDbTs(lastBasal.created_at)) / 3600_000));
    messages.push({
      key: "engine_rec_basal",
      params: { units: lastBasal.units, name: lastBasal.insulin_name || "", hours: hAgo },
    });
  }

  const fourHoursAgo = nowMs - 4 * 3600_000;
  const recentExercise = (input.recentExerciseLogs ?? [])
    .filter(l => parseDbTs(l.created_at) >= fourHoursAgo)
    .sort((x, y) => parseDbTs(y.created_at) - parseDbTs(x.created_at))[0];
  if (recentExercise) {
    const hAgo = Math.max(0, Math.round((nowMs - parseDbTs(recentExercise.created_at)) / 3600_000));
    messages.push({
      key: "engine_rec_exercise",
      params: {
        minutes: recentExercise.duration_minutes,
        type: recentExercise.exercise_type,
        intensity: recentExercise.intensity,
        hours: hAgo,
      },
    });
  }

  // Task #183: Apple-Health-Tagesaktivität als reine Annotation.
  // Threshold logic is delegated to the shared `isHighActivityDay`
  // predicate so the per-meal evaluator and this recommender always
  // agree on what counts as "active today".
  const act = input.activityContext ?? null;
  if (act && isHighActivityDay(act)) {
    messages.push({
      key: "engine_rec_high_activity",
      params: {
        steps: act.todaySteps!,
        avg: act.avgSteps7d!,
      },
    });
  }

  const reasoningParts: string[] = [];
  if (carbs === 0 && correctionDose === 0) {
    reasoningParts.push("No carbs and BG within target — no dose calculated.");
  }
  if (clamped) {
    reasoningParts.push(`Clamped to safety ceiling of ${MAX_DOSE_UNITS}u.`);
  }
  if (recentBolusCount > 2) {
    reasoningParts.push(`${recentBolusCount} Bolus-Dosen in den letzten 6h — Active Insulin beachten.`);
  }
  if (lastBasal) {
    const basalHAgo = Math.max(0, Math.round((nowMs - parseDbTs(lastBasal.created_at)) / 3600_000));
    reasoningParts.push(`Basal: ${lastBasal.units}u ${lastBasal.insulin_name || ""} vor ${basalHAgo}h`.trimEnd());
  }
  if (recentExercise) {
    reasoningParts.push(`${recentExercise.duration_minutes} min ${recentExercise.exercise_type} (${recentExercise.intensity}) — erhöhte Insulin-Sensitivität möglich.`);
  }

  return {
    recommendedUnits: Math.round(total * 2) / 2,
    carbDose: Math.round(carbDose * 10) / 10,
    correctionDose: Math.round(correctionDose * 10) / 10,
    blocked: false,
    messages,
    confidence,
    icrUsed,
    icrSource,
    reasoning: reasoningParts.join(" "),
  };
}
