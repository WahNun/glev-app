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
  cappedForSafety: boolean;
}

const TIMING_MAP: Record<MealType, TimingType> = {
  FAST_CARBS: "BEFORE_MEAL",
  HIGH_FAT:   "SPLIT_DOSE",
  HIGH_PROTEIN: "SPLIT_DOSE",
  BALANCED:   "BEFORE_MEAL",
};

// Safety cap: never exceed this unless glucose is significantly elevated
const SAFETY_CAP_UNITS = 3.0;
const SAFETY_CAP_GLUCOSE_THRESHOLD = 180; // only bypass cap above this

// Stability filter thresholds — only meals with a stable outcome are used for ratio
const STABLE_GLUCOSE_AFTER_MIN = 80;
const STABLE_GLUCOSE_AFTER_MAX = 175;
const STABLE_DELTA_MAX = 55; // mg/dL rise cap

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Determines whether an entry represents a STABLE meal outcome that can
 * safely be used for ratio computation.
 *
 * Excludes:
 *  - Any entry that resulted in hypoglycemia (glucoseAfter < 80)
 *  - Any entry that resulted in an extreme spike (glucoseAfter > 175)
 *  - Any entry where the delta was very large (> 55 mg/dL rise)
 *  - Any entry where evaluation is not strictly GOOD
 */
function isStable(e: Entry): boolean {
  if (e.evaluation !== "GOOD") return false;
  if (e.glucoseAfter == null) return false;
  if (e.glucoseAfter < STABLE_GLUCOSE_AFTER_MIN) return false; // hypo — dose was too high
  if (e.glucoseAfter > STABLE_GLUCOSE_AFTER_MAX) return false; // extreme spike — dose was too low
  if (e.delta != null && e.delta > STABLE_DELTA_MAX) return false; // steep rise even if still in range
  if (e.insulinUnits <= 0 || e.carbsGrams <= 0) return false;
  return true;
}

export function calculatePersonalBolus(
  carbsGrams: number,
  glucoseBefore: number,
  mealType: MealType,
  allEntries: Entry[], // newest first
  fiberGrams = 0,
): RecommendationResult {
  const timing = TIMING_MAP[mealType];

  // Net carbs = total carbs − fiber (fiber slows absorption, reduces effective load)
  const netCarbs = Math.max(0, carbsGrams - fiberGrams);

  // Only stable, GOOD-evaluated meals feed into the ratio
  const stableEntries = allEntries.filter(isStable);

  if (stableEntries.length === 0) {
    return fallbackRecommendation(netCarbs, carbsGrams, fiberGrams, glucoseBefore, mealType, timing);
  }

  // Carbs-per-unit ratio from history: use net carbs if available, else total carbs
  const withRatio = stableEntries.map((e) => {
    const entryNet = Math.max(0, e.carbsGrams - ((e as Entry & { fiberGrams?: number | null }).fiberGrams ?? 0));
    const effectiveCarbs = entryNet > 0 ? entryNet : e.carbsGrams;
    return { ...e, ratio: effectiveCarbs / e.insulinUnits };
  });

  // A) RECENT — last 10 stable meals
  const recent = withRatio.slice(0, 10);

  // B) SIMILAR — same meal type, net carbs within ±20g
  const similar = withRatio.filter(
    (e) => e.mealType === mealType && Math.abs(e.carbsGrams - carbsGrams) <= 20,
  );

  // C) GLOBAL — all stable
  const global = withRatio;

  const recentAvg = avg(recent.map((e) => e.ratio));
  const similarAvg = similar.length > 0 ? avg(similar.map((e) => e.ratio)) : recentAvg;
  const globalAvg  = avg(global.map((e) => e.ratio));

  // Weighted ratio: 60% recent · 30% similar · 10% global
  const weightedRatio =
    similar.length > 0
      ? 0.6 * recentAvg + 0.3 * similarAvg + 0.1 * globalAvg
      : 0.7 * recentAvg + 0.3 * globalAvg;

  if (weightedRatio <= 0) {
    return fallbackRecommendation(netCarbs, carbsGrams, fiberGrams, glucoseBefore, mealType, timing);
  }

  // Base insulin dose — always uses net carbs
  let units = netCarbs / weightedRatio;

  // Glucose correction (only applied when clearly outside range)
  let glucoseAdjustment = 0;
  if (glucoseBefore < 90) {
    glucoseAdjustment = glucoseBefore < 70 ? -0.5 : -0.5;
  } else if (glucoseBefore > 140) {
    glucoseAdjustment = glucoseBefore > 200 ? 1.0 : 0.5;
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

  units = Math.max(0.5, units);

  // ─── SAFETY CAP ────────────────────────────────────────────────
  // Never suggest more than 3 units unless glucose is significantly elevated.
  // This prevents catastrophic overdose from data outliers or edge cases.
  let cappedForSafety = false;
  if (glucoseBefore <= SAFETY_CAP_GLUCOSE_THRESHOLD && units > SAFETY_CAP_UNITS) {
    units = SAFETY_CAP_UNITS;
    cappedForSafety = true;
  }

  const roundedUnits = r2(Math.round(units * 2) / 2); // nearest 0.5u

  const confidence: ConfidenceType =
    similar.length >= 5 ? "HIGH" : similar.length >= 2 ? "MEDIUM" : "LOW";

  const reasoning = buildReasoning(
    mealType,
    carbsGrams,
    fiberGrams,
    netCarbs,
    glucoseBefore,
    similar.length,
    recent.length,
    stableEntries.length,
    r2(weightedRatio),
    glucoseAdjustment,
    mealAdjustment,
    cappedForSafety,
  );

  return {
    recommendedUnits: roundedUnits,
    minUnits: Math.max(0.5, r2(roundedUnits * 0.9)),
    maxUnits: r2(roundedUnits * 1.1),
    confidence,
    timing,
    reasoning,
    basedOnEntries: stableEntries.length,
    similarMealCount: similar.length,
    recentCount: recent.length,
    carbRatio: r2(weightedRatio),
    cappedForSafety,
  };
}

function fallbackRecommendation(
  netCarbs: number,
  carbsGrams: number,
  fiberGrams: number,
  glucoseBefore: number,
  mealType: MealType,
  timing: TimingType,
): RecommendationResult {
  const DEFAULT_RATIO = 35;
  let units = netCarbs / DEFAULT_RATIO;
  if (glucoseBefore > 140) units += 0.5;
  if (glucoseBefore < 90)  units -= 0.5;

  const capped = glucoseBefore <= SAFETY_CAP_GLUCOSE_THRESHOLD && units > SAFETY_CAP_UNITS;
  units = capped ? SAFETY_CAP_UNITS : Math.max(0.5, units);

  const fiberNote = fiberGrams > 0
    ? ` Net carbs: ${netCarbs}g (${carbsGrams}g − ${fiberGrams}g fiber).`
    : "";

  return {
    recommendedUnits: r2(Math.round(units * 2) / 2),
    minUnits: Math.max(0.5, r2(units * 0.85)),
    maxUnits: r2(units * 1.15),
    confidence: "LOW",
    timing,
    reasoning: `No stable historical data yet. Using 1u per ${DEFAULT_RATIO}g default.${fiberNote} Log meals with after-meal readings to build your profile.`,
    basedOnEntries: 0,
    similarMealCount: 0,
    recentCount: 0,
    carbRatio: DEFAULT_RATIO,
    cappedForSafety: capped,
  };
}

function buildReasoning(
  mealType: MealType,
  carbsGrams: number,
  fiberGrams: number,
  netCarbs: number,
  glucoseBefore: number,
  similarCount: number,
  recentCount: number,
  stableCount: number,
  carbRatio: number,
  glucoseAdj: number,
  mealAdj: number,
  capped: boolean,
): string {
  const mealLabel: Record<MealType, string> = {
    FAST_CARBS: "fast carb", HIGH_FAT: "high fat",
    HIGH_PROTEIN: "high protein", BALANCED: "balanced",
  };

  const parts: string[] = [];

  if (similarCount >= 2) {
    parts.push(
      `Based on ${similarCount} stable ${mealLabel[mealType]} meals (~${carbsGrams}g) from ${stableCount} total stable entries.`,
    );
  } else if (recentCount >= 2) {
    parts.push(
      `Based on ${recentCount} recent stable meals (no close match for ${mealLabel[mealType]} at ${carbsGrams}g). ${stableCount} stable entries total.`,
    );
  } else {
    parts.push(`Limited stable data — ${stableCount} qualifying entries. Hypo and spike meals excluded.`);
  }

  if (fiberGrams > 0) {
    parts.push(`Net carbs: ${netCarbs}g (${carbsGrams}g total − ${fiberGrams}g fiber). Dose is based on net carbs — fiber slows absorption.`);
  }

  parts.push(`Personal carb ratio: 1u per ${carbRatio}g (60% recent · 30% similar · 10% all-time).`);

  if (glucoseAdj > 0) {
    parts.push(`+${glucoseAdj}u correction: starting glucose ${glucoseBefore} mg/dL is above target.`);
  } else if (glucoseAdj < 0) {
    parts.push(`${glucoseAdj}u correction: starting glucose ${glucoseBefore} mg/dL is below target — monitor for hypo.`);
  }

  if (mealType === "FAST_CARBS") {
    parts.push(`+0.5u for fast carbs. Take 15 min before eating.`);
  } else if (mealType === "HIGH_FAT") {
    parts.push(`−0.5u for high fat. Split dose: 60% now, 40% after 90 min.`);
  } else if (mealType === "HIGH_PROTEIN") {
    parts.push(`No adjustment for high protein. Monitor at 2–3h for delayed effect.`);
  }

  if (capped) {
    parts.push(`SAFETY CAP applied: dose capped at ${SAFETY_CAP_UNITS}u (glucose ≤ ${SAFETY_CAP_GLUCOSE_THRESHOLD} mg/dL). Override manually if needed.`);
  }

  return parts.join(" ");
}
