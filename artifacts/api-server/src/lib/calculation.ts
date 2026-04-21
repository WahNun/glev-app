export type Evaluation =
  | "GOOD"
  | "SLIGHT_UNDERDOSE"
  | "UNDERDOSE"
  | "SLIGHT_OVERDOSE"
  | "OVERDOSE";

export type MealType = "FAST_CARBS" | "HIGH_FAT" | "HIGH_PROTEIN" | "BALANCED";

export interface GlucoseMetrics {
  delta: number | null;
  speed: number | null;
  evaluation: Evaluation | null;
}

export function calculateMetrics(
  glucoseBefore: number,
  glucoseAfter: number | null | undefined,
  timeDifferenceMinutes: number | null | undefined,
  insulinUnits: number,
  carbsGrams: number,
): GlucoseMetrics {
  if (glucoseAfter == null || timeDifferenceMinutes == null || timeDifferenceMinutes <= 0) {
    return { delta: null, speed: null, evaluation: null };
  }

  const delta = glucoseAfter - glucoseBefore;
  const hours = timeDifferenceMinutes / 60;
  const speed = delta / hours;

  const evaluation = evaluateReading(glucoseBefore, glucoseAfter, delta, speed, insulinUnits, carbsGrams);
  return { delta, speed, evaluation };
}

function evaluateReading(
  _glucoseBefore: number,
  glucoseAfter: number,
  delta: number,
  speed: number,
  _insulinUnits: number,
  _carbsGrams: number,
): Evaluation {
  if (glucoseAfter < 70) return "OVERDOSE";

  if (speed < -60 || delta < -40) return "OVERDOSE";
  if (speed < -30 || delta < -20) return "SLIGHT_OVERDOSE";

  if (speed > 60 || delta > 60) return "UNDERDOSE";
  if (speed > 30 || delta > 40) return "SLIGHT_UNDERDOSE";

  if (glucoseAfter >= 80 && glucoseAfter <= 175 && delta >= -20 && delta <= 40) {
    return "GOOD";
  }

  if (glucoseAfter > 180) return "UNDERDOSE";
  if (glucoseAfter > 140) return "SLIGHT_UNDERDOSE";

  return "GOOD";
}

export function classifyMealType(mealType: MealType, carbsGrams: number): MealType {
  if (carbsGrams > 60) return "FAST_CARBS";
  return mealType;
}

export function calculateControlScore(evaluations: (string | null)[]): number {
  if (evaluations.length === 0) return 0;
  const good = evaluations.filter((e) => e === "GOOD").length;
  return Math.round((good / evaluations.length) * 100);
}

export function calculateHypoRate(glucoseAfters: (number | null)[]): number {
  const withData = glucoseAfters.filter((g): g is number => g != null);
  if (withData.length === 0) return 0;
  const hypos = withData.filter((g) => g < 70).length;
  return Math.round((hypos / withData.length) * 100);
}

export function calculateSpikeRate(glucoseAfters: (number | null)[]): number {
  const withData = glucoseAfters.filter((g): g is number => g != null);
  if (withData.length === 0) return 0;
  const spikes = withData.filter((g) => g > 180).length;
  return Math.round((spikes / withData.length) * 100);
}
