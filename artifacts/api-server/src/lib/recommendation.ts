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
  similarMealCount: number;
  recentCount: number;
  carbRatio: number;
}

const TIMING_MAP: Record<MealType, TimingType> = {
  FAST_CARBS: "BEFORE_MEAL",
  HIGH_FAT: "SPLIT_DOSE",
  HIGH_PROTEIN: "SPLIT_DOSE",
  BALANCED: "BEFORE_MEAL",
};

const VALID_EVALUATIONS = new Set(["GOOD", "CHECK_CONTEXT"]);

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

export function calculatePersonalBolus(
  carbsGrams: number,
  glucoseBefore: number,
  mealType: MealType,
  allEntries: Entry[],
): RecommendationResult {
  const timing = TIMING_MAP[mealType];

  const validEntries = allEntries.filter(
    (e) =>
      e.evaluation != null &&
      VALID_EVALUATIONS.has(e.evaluation) &&
      e.insulinUnits > 0 &&
      e.carbsGrams > 0,
  );

  if (validEntries.length === 0) {
    return fallbackRecommendation(carbsGrams, glucoseBefore, mealType, timing);
  }

  // Compute carbs-per-unit ratio for each valid entry (higher = less aggressive)
  const withRatio = validEntries.map((e) => ({
    ...e,
    ratio: e.carbsGrams / e.insulinUnits,
  }));

  // A) RECENT — last 10 valid meals regardless of type
  const recent = withRatio.slice(0, 10);

  // B) SIMILAR — carbs within ±20g AND same meal type
  const similar = withRatio.filter(
    (e) =>
      e.mealType === mealType &&
      Math.abs(e.carbsGrams - carbsGrams) <= 20,
  );

  // C) GLOBAL — all valid
  const global = withRatio;

  const recentAvg = avg(recent.map((e) => e.ratio));
  const similarAvg = similar.length > 0 ? avg(similar.map((e) => e.ratio)) : recentAvg;
  const globalAvg = avg(global.map((e) => e.ratio));

  // Weighted ratio: 60% recent, 30% similar, 10% global
  const weightedRatio =
    similar.length > 0
      ? 0.6 * recentAvg + 0.3 * similarAvg + 0.1 * globalAvg
      : 0.7 * recentAvg + 0.3 * globalAvg;

  if (weightedRatio <= 0) {
    return fallbackRecommendation(carbsGrams, glucoseBefore, mealType, timing);
  }

  // Base insulin dose
  let units = carbsGrams / weightedRatio;

  // Glucose correction
  let glucoseAdjustment = 0;
  if (glucoseBefore < 90) {
    glucoseAdjustment = glucoseBefore < 70 ? -1.0 : -0.5;
  } else if (glucoseBefore > 140) {
    glucoseAdjustment = glucoseBefore > 180 ? 1.0 : 0.5;
  }
  units += glucoseAdjustment;

  // Meal composition adjustment
  let mealAdjustment = 0;
  if (mealType === "FAST_CARBS") {
    mealAdjustment = 0.5;
  } else if (mealType === "HIGH_FAT") {
    mealAdjustment = -0.5;
  }
  units += mealAdjustment;

  const totalUnits = Math.max(0.5, units);
  const roundedUnits = r2(Math.round(totalUnits * 2) / 2); // round to nearest 0.5

  const confidence: ConfidenceType =
    similar.length >= 5 ? "HIGH" : similar.length >= 2 ? "MEDIUM" : "LOW";

  const reasoning = buildReasoning(
    mealType,
    carbsGrams,
    glucoseBefore,
    similar.length,
    recent.length,
    r2(weightedRatio),
    glucoseAdjustment,
    mealAdjustment,
  );

  return {
    recommendedUnits: roundedUnits,
    minUnits: Math.max(0.5, r2(roundedUnits * 0.9)),
    maxUnits: r2(roundedUnits * 1.1),
    confidence,
    timing,
    reasoning,
    basedOnEntries: validEntries.length,
    similarMealCount: similar.length,
    recentCount: recent.length,
    carbRatio: r2(weightedRatio),
  };
}

function fallbackRecommendation(
  carbsGrams: number,
  glucoseBefore: number,
  mealType: MealType,
  timing: TimingType,
): RecommendationResult {
  const DEFAULT_RATIO = 15;
  let units = carbsGrams / DEFAULT_RATIO;
  if (glucoseBefore > 140) units += 0.5;
  if (glucoseBefore < 90) units -= 0.5;
  const totalUnits = Math.max(0.5, units);

  return {
    recommendedUnits: r2(Math.round(totalUnits * 2) / 2),
    minUnits: Math.max(0.5, r2(totalUnits * 0.85)),
    maxUnits: r2(totalUnits * 1.15),
    confidence: "LOW",
    timing,
    reasoning: `No historical data available. Using conservative default ratio of 1u per ${DEFAULT_RATIO}g carbs. Log meals with after-meal readings to unlock personalized recommendations.`,
    basedOnEntries: 0,
    similarMealCount: 0,
    recentCount: 0,
    carbRatio: DEFAULT_RATIO,
  };
}

function buildReasoning(
  mealType: MealType,
  carbsGrams: number,
  glucoseBefore: number,
  similarCount: number,
  recentCount: number,
  carbRatio: number,
  glucoseAdj: number,
  mealAdj: number,
): string {
  const mealLabel: Record<MealType, string> = {
    FAST_CARBS: "fast carb",
    HIGH_FAT: "high fat",
    HIGH_PROTEIN: "high protein",
    BALANCED: "balanced",
  };

  let parts: string[] = [];

  if (similarCount >= 2) {
    parts.push(
      `Based on ${similarCount} similar ${mealLabel[mealType]} meals (~${carbsGrams}g carbs) and ${recentCount} recent entries.`,
    );
  } else if (recentCount >= 2) {
    parts.push(
      `Based on ${recentCount} recent meals (no close match for ${mealLabel[mealType]} at ${carbsGrams}g).`,
    );
  } else {
    parts.push(`Limited data — only ${recentCount} valid entries available.`);
  }

  parts.push(`Personal carb ratio: 1u per ${carbRatio}g (weighted: 60% recent, 30% similar, 10% all-time).`);

  if (glucoseAdj > 0) {
    parts.push(`+${glucoseAdj}u added: starting glucose ${glucoseBefore} mg/dL is above target.`);
  } else if (glucoseAdj < 0) {
    parts.push(`${glucoseAdj}u removed: starting glucose ${glucoseBefore} mg/dL is below target — watch for hypo.`);
  }

  if (mealType === "FAST_CARBS") {
    parts.push(`+0.5u added for fast carbs. Take 15 min before eating.`);
  } else if (mealType === "HIGH_FAT") {
    parts.push(`-0.5u removed for high fat content. Split dose: 60% now, 40% in 90 min.`);
  } else if (mealType === "HIGH_PROTEIN") {
    parts.push(`No meal-type adjustment. Monitor at 2–3h mark for delayed protein effect.`);
  }

  return parts.join(" ");
}
