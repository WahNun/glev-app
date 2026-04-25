import type { AdaptiveICR, TimeOfDay } from "./adaptiveICR";
import type { InsulinLog } from "../insulin";
import type { ExerciseLog } from "../exercise";

export interface RecommendInput {
  carbs: number;
  currentBG: number | null;
  targetBG?: number;
  adaptiveICR: AdaptiveICR;
  correctionFactor?: number;
  timeOfDay?: TimeOfDay;
  /**
   * Optional standalone insulin / exercise logs — used to surface stacking
   * warnings and basal-context notes in the reasoning string. Pure
   * documentation: never mutates the recommended dose.
   */
  recentInsulinLogs?: InsulinLog[];
  recentExerciseLogs?: ExerciseLog[];
}

export interface RecommendOutput {
  recommendedUnits: number;
  carbDose: number;
  correctionDose: number;
  blocked: boolean;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  icrUsed: number;
  icrSource: "morning" | "afternoon" | "evening" | "global" | "default";
}

const DEFAULT_ICR = 15; // grams per unit
const DEFAULT_CF  = 50; // mg/dL drop per unit
const DEFAULT_TARGET = 100;
const SAFETY_BG_MIN = 80;
const MAX_DOSE_UNITS = 25; // hard ceiling — anything above is clamped + flagged

function safePositive(n: number | null | undefined, fallback: number): number {
  return n != null && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function recommendDose(input: RecommendInput): RecommendOutput {
  const carbs    = Math.max(0, Number.isFinite(input.carbs) ? input.carbs : 0);
  const targetBG = safePositive(input.targetBG, DEFAULT_TARGET);
  const cf       = safePositive(input.correctionFactor, DEFAULT_CF);

  // Pick the most specific ICR available — ignore non-positive/NaN learned values.
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
      reasoning: `Current glucose ${input.currentBG} mg/dL is below the safety floor (${SAFETY_BG_MIN}). Treat the low first; do not dose.`,
      confidence: "high", icrUsed, icrSource,
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

  const parts: string[] = [];
  if (carbs > 0)  parts.push(`${carbs}g ÷ 1u/${icrUsed.toFixed(1)}g (${icrSource}) = ${carbDose.toFixed(2)}u`);
  if (correctionDose > 0) parts.push(`(${input.currentBG} − ${targetBG}) ÷ ${cf} = +${correctionDose.toFixed(2)}u`);
  if (parts.length === 0) parts.push("No carbs and BG within target — no dose recommended.");
  if (clamped) parts.push(`Clamped to safety ceiling of ${MAX_DOSE_UNITS}u — verify carb count or consult clinician.`);

  // Safety hooks from standalone logs — documentation only, no dose change.
  const nowMs = Date.now();
  const sixHoursAgo = nowMs - 6 * 3600_000;
  const oneDayAgo   = nowMs - 24 * 3600_000;

  const recentBolusCount = (input.recentInsulinLogs ?? [])
    .filter(l => l.insulin_type === "bolus" && new Date(l.created_at).getTime() >= sixHoursAgo)
    .length;
  if (recentBolusCount > 2) {
    parts.push(`⚠ ${recentBolusCount} Bolus-Dosen in den letzten 6h — Active Insulin könnte noch wirken.`);
  }

  const lastBasal = (input.recentInsulinLogs ?? [])
    .filter(l => l.insulin_type === "basal" && new Date(l.created_at).getTime() >= oneDayAgo)
    .sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime())[0];
  if (lastBasal) {
    const hAgo = Math.max(0, Math.round((nowMs - new Date(lastBasal.created_at).getTime()) / 3600_000));
    parts.push(`Basal: ${lastBasal.units}u ${lastBasal.insulin_name || "Basal"} vor ${hAgo}h.`);
  }

  // Exercise sensitivity hint — last 4h, documentation only.
  const fourHoursAgo = nowMs - 4 * 3600_000;
  const recentExercise = (input.recentExerciseLogs ?? [])
    .filter(l => new Date(l.created_at).getTime() >= fourHoursAgo)
    .sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime())[0];
  if (recentExercise) {
    const hAgo = Math.max(0, Math.round((nowMs - new Date(recentExercise.created_at).getTime()) / 3600_000));
    parts.push(`⚠ ${recentExercise.duration_minutes} min ${recentExercise.exercise_type} (${recentExercise.intensity}) vor ${hAgo}h — erhöhte Insulin-Sensitivität möglich.`);
  }

  return {
    recommendedUnits: Math.round(total * 2) / 2, // half-unit rounding
    carbDose: Math.round(carbDose * 10) / 10,
    correctionDose: Math.round(correctionDose * 10) / 10,
    blocked: false,
    reasoning: parts.join(" · "),
    confidence,
    icrUsed,
    icrSource,
  };
}
