import type { InsulinLog } from "../insulin";
import type { ExerciseLog } from "../exercise";
import { parseDbTs } from "@/lib/time";
import { getInsulinSettings, type InsulinSettings } from "@/lib/userSettings";

export type Outcome = "GOOD" | "UNDERDOSE" | "OVERDOSE" | "SPIKE" | "CHECK_CONTEXT";

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
  /**
   * Glucose-velocity context from lifecycleFor (mg/dL per minute over
   * the first 60 / 120 min). When provided, the reasoning string
   * surfaces the speed numerically so the entries page can show
   * "BG rose at +0.8 mg/dL/min in the first hour" without re-deriving
   * it. Pure documentation — does not change the computed outcome.
   */
  speed1?: number | null;
  speed2?: number | null;
  /**
   * Optional context from the standalone insulin / exercise logs.
   * When provided, the reasoning string mentions a recent basal dose
   * or a recent exercise session that may explain the outcome.
   * Pure documentation — does not change the computed outcome.
   */
  recentInsulinLogs?: InsulinLog[];
  recentExerciseLogs?: ExerciseLog[];
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
  reasoning: string;
  confidence: "high" | "medium" | "low";
  delta: number | null;
  netCarbs: number;
}

/** Render context notes derived from recent logs. Documentation only. */
function contextSuffix(
  insulinLogs: InsulinLog[] = [],
  exerciseLogs: ExerciseLog[] = [],
): string {
  const now = Date.now();
  const dayAgo = now - 24 * 3600_000;
  const fourHoursAgo = now - 4 * 3600_000;
  const notes: string[] = [];

  const recentBasal = insulinLogs.find(l =>
    l.insulin_type === "basal" && parseDbTs(l.created_at) >= dayAgo,
  );
  if (recentBasal) {
    const hoursAgo = Math.max(0, Math.round((now - parseDbTs(recentBasal.created_at)) / 3600_000));
    notes.push(`Basal-Kontext: ${recentBasal.units}u ${recentBasal.insulin_name || "Basal"} vor ${hoursAgo}h.`);
  }

  const recentExercise = exerciseLogs.find(l =>
    parseDbTs(l.created_at) >= fourHoursAgo,
  );
  if (recentExercise) {
    notes.push(`Bewegung: ${recentExercise.duration_minutes} min ${recentExercise.exercise_type} (${recentExercise.intensity}) in den letzten 4h.`);
  }

  return notes.length > 0 ? " " + notes.join(" ") : "";
}

/** Render glucose-velocity notes from the lifecycle's speed1 / speed2,
 *  e.g. "BG rose at +0.38 mg/dL/min in the first hour." Surfaces the
 *  numeric speed inside the reasoning string so the entries page and
 *  insights drawer can show "how fast" without re-deriving it. */
function speedSuffix(speed1?: number | null, speed2?: number | null): string {
  const parts: string[] = [];
  if (speed1 != null && Number.isFinite(speed1)) {
    const verb = speed1 >= 0 ? "rose" : "fell";
    const sign = speed1 >= 0 ? "+" : "";
    parts.push(`BG ${verb} at ${sign}${speed1.toFixed(2)} mg/dL/min in the first hour.`);
  }
  if (speed2 != null && Number.isFinite(speed2)) {
    const verb = speed2 >= 0 ? "rose" : "fell";
    const sign = speed2 >= 0 ? "+" : "";
    parts.push(`BG ${verb} at ${sign}${speed2.toFixed(2)} mg/dL/min over the 2-hour window.`);
  }
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

/**
 * Deterministic post-hoc evaluation — single source of truth for
 * outcome labelling across the app. Uses the glucose delta
 * (bgAfter - bgBefore) as ground truth; if bgAfter is missing, falls
 * back to a conservative ICR-ratio estimate using the user's
 * personal ICR / CF / target BG (or DEFAULT_INSULIN_SETTINGS with a
 * console warning) so entries without a post-meal reading still get
 * a label.
 */
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

  // Classification-aware spike thresholds.
  // FAST_CARBS absorb faster → a bigger rise is still normal.
  // HIGH_FAT   delays glucose → an early rise is more suspicious.
  const spikeCutoff =
    cls === "FAST_CARBS" ? 70 :
    cls === "HIGH_FAT"   ? 40 :
    cls === "HIGH_PROTEIN" ? 50 :
    55;

  if (delta != null) {
    let outcome: Outcome;
    let reasoning: string;
    if (delta > spikeCutoff) {
      outcome = "SPIKE";
      reasoning = `Post-meal glucose rose ${delta} mg/dL — rapid spike beyond the ${spikeCutoff} mg/dL threshold for ${labelFor(cls)}.`;
    } else if (delta > 30) {
      outcome = "UNDERDOSE";
      reasoning = `Post-meal glucose rose ${delta} mg/dL — insulin insufficient for the carb load.`;
    } else if (delta < -30) {
      outcome = "OVERDOSE";
      reasoning = `Post-meal glucose dropped ${Math.abs(delta)} mg/dL — insulin exceeded glucose needs.`;
    } else {
      outcome = "GOOD";
      reasoning = `Glucose stayed within ±30 mg/dL (Δ${delta > 0 ? "+" : ""}${delta}) — dose matched the meal.`;
    }
    const confidence: EvaluateEntryResult["confidence"] =
      Math.abs(delta) > 80 ? "high" : Math.abs(delta) > 25 ? "medium" : "high";
    reasoning += speedSuffix(input.speed1, input.speed2);
    reasoning += contextSuffix(input.recentInsulinLogs, input.recentExerciseLogs);
    return { outcome, reasoning, confidence, delta, netCarbs };
  }

  // No bgAfter: fallback ICR-ratio heuristic using personal settings.
  let expected = netCarbs / settings.icr;
  if (bgBefore && bgBefore > settings.targetBg) expected += (bgBefore - settings.targetBg) / settings.cf;
  const ratio = insulin / Math.max(expected, 0.1);

  let outcome: Outcome;
  let reasoning: string;
  if (ratio > 1.35) {
    outcome = "OVERDOSE";
    reasoning = `Dose is ${Math.round((ratio - 1) * 100)}% above the ICR-expected amount — likely over-dose (no post-meal reading).`;
  } else if (ratio < 0.65) {
    outcome = "UNDERDOSE";
    reasoning = `Dose is ${Math.round((1 - ratio) * 100)}% below the ICR-expected amount — likely under-dose (no post-meal reading).`;
  } else {
    outcome = "GOOD";
    reasoning = `Dose matches the ICR-expected amount within ±35% (no post-meal reading to confirm).`;
  }
  reasoning += speedSuffix(input.speed1, input.speed2);
  reasoning += contextSuffix(input.recentInsulinLogs, input.recentExerciseLogs);
  return { outcome, reasoning, confidence: "low", delta: null, netCarbs };
}

function labelFor(cls: Classification) {
  switch (cls) {
    case "FAST_CARBS":   return "fast-carb meals";
    case "HIGH_PROTEIN": return "high-protein meals";
    case "HIGH_FAT":     return "high-fat meals";
    default:             return "balanced meals";
  }
}
