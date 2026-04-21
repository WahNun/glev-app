import type { Entry } from "@workspace/db";

export type MealType = "FAST_CARBS" | "HIGH_FAT" | "HIGH_PROTEIN" | "BALANCED";
export type TimingType = "BEFORE_MEAL" | "SPLIT_DOSE" | "WITH_MEAL";
export type ConfidenceType = "HIGH" | "MEDIUM" | "LOW";

export interface RecommendationResult {
  recommendedUnits: number;
  minUnits: number;
  maxUnits: number;
  confidence: ConfidenceType;
  timing: TimingType;
  reasoning: string;
  basedOnEntries: number;
}

const TIMING_MAP: Record<MealType, TimingType> = {
  FAST_CARBS: "BEFORE_MEAL",
  HIGH_FAT: "SPLIT_DOSE",
  HIGH_PROTEIN: "SPLIT_DOSE",
  BALANCED: "BEFORE_MEAL",
};

const BASE_CARB_RATIO = 10;

export function generateRecommendation(
  carbsGrams: number,
  glucoseBefore: number,
  mealType: MealType,
  similarEntries: Entry[],
): RecommendationResult {
  const timing = TIMING_MAP[mealType];
  const goodEntries = similarEntries.filter((e) => e.evaluation === "GOOD");

  if (goodEntries.length >= 3) {
    const avgUnits =
      goodEntries.reduce((sum, e) => sum + e.insulinUnits, 0) / goodEntries.length;
    const avgCarbs =
      goodEntries.reduce((sum, e) => sum + e.carbsGrams, 0) / goodEntries.length;

    const ratioUnitsPerCarb = avgUnits / avgCarbs;
    const recommendedUnits = Math.round(ratioUnitsPerCarb * carbsGrams * 10) / 10;

    const correctionUnits = getCorrectionUnits(glucoseBefore);
    const totalUnits = Math.max(0.5, recommendedUnits + correctionUnits);
    const stdDev = calculateStdDev(goodEntries.map((e) => e.insulinUnits));

    return {
      recommendedUnits: Math.round(totalUnits * 10) / 10,
      minUnits: Math.max(0.5, Math.round((totalUnits - stdDev) * 10) / 10),
      maxUnits: Math.round((totalUnits + stdDev) * 10) / 10,
      confidence: goodEntries.length >= 5 ? "HIGH" : "MEDIUM",
      timing,
      reasoning: buildReasoning(mealType, carbsGrams, goodEntries.length, glucoseBefore, correctionUnits),
      basedOnEntries: goodEntries.length,
    };
  }

  if (similarEntries.length >= 1) {
    const baseUnits = (carbsGrams / BASE_CARB_RATIO) * 1.0;
    const correctionUnits = getCorrectionUnits(glucoseBefore);
    const totalUnits = Math.max(0.5, baseUnits + correctionUnits);

    return {
      recommendedUnits: Math.round(totalUnits * 10) / 10,
      minUnits: Math.max(0.5, Math.round((totalUnits * 0.8) * 10) / 10),
      maxUnits: Math.round((totalUnits * 1.2) * 10) / 10,
      confidence: "LOW",
      timing,
      reasoning: `Limited data for ${formatMealType(mealType)} meals. Using general formula: ${carbsGrams}g carbs ÷ ${BASE_CARB_RATIO}g per unit${correctionUnits !== 0 ? ` + ${correctionUnits > 0 ? "+" : ""}${correctionUnits}u correction` : ""}. Log more meals to improve accuracy.`,
      basedOnEntries: similarEntries.length,
    };
  }

  const baseUnits = (carbsGrams / BASE_CARB_RATIO) * 1.0;
  const correctionUnits = getCorrectionUnits(glucoseBefore);
  const totalUnits = Math.max(0.5, baseUnits + correctionUnits);

  return {
    recommendedUnits: Math.round(totalUnits * 10) / 10,
    minUnits: Math.max(0.5, Math.round((totalUnits * 0.75) * 10) / 10),
    maxUnits: Math.round((totalUnits * 1.25) * 10) / 10,
    confidence: "LOW",
    timing,
    reasoning: `No historical data yet. Using general formula: ${carbsGrams}g carbs at 1u per ${BASE_CARB_RATIO}g${correctionUnits !== 0 ? ` + ${correctionUnits > 0 ? "+" : ""}${correctionUnits}u correction for BG ${glucoseBefore} mg/dL` : ""}. Log meals to get personalized recommendations.`,
    basedOnEntries: 0,
  };
}

function getCorrectionUnits(glucoseBefore: number): number {
  const TARGET = 100;
  const SENSITIVITY_FACTOR = 50;

  if (glucoseBefore <= 100) return 0;
  const correction = (glucoseBefore - TARGET) / SENSITIVITY_FACTOR;
  return Math.round(correction * 10) / 10;
}

function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0.5;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.max(0.5, Math.sqrt(variance));
}

function formatMealType(mealType: MealType): string {
  const labels: Record<MealType, string> = {
    FAST_CARBS: "fast carb",
    HIGH_FAT: "high fat",
    HIGH_PROTEIN: "high protein",
    BALANCED: "balanced",
  };
  return labels[mealType];
}

function buildReasoning(
  mealType: MealType,
  carbsGrams: number,
  sampleSize: number,
  glucoseBefore: number,
  correctionUnits: number,
): string {
  const mealLabel = formatMealType(mealType);
  let reasoning = `Based on ${sampleSize} successful ${mealLabel} meals with similar carb intake (${carbsGrams}g).`;

  if (correctionUnits > 0) {
    reasoning += ` Added ${correctionUnits}u correction for elevated starting glucose (${glucoseBefore} mg/dL).`;
  } else if (correctionUnits < 0) {
    reasoning += ` Reduced by ${Math.abs(correctionUnits)}u as starting glucose (${glucoseBefore} mg/dL) is below target.`;
  }

  if (mealType === "HIGH_FAT" || mealType === "HIGH_PROTEIN") {
    reasoning += " Split dose recommended: take 60% now, 40% after 1-2 hours due to delayed glucose absorption.";
  }

  return reasoning;
}
