import type { Meal } from "@/lib/meals";
import { lifecycleFor } from "./lifecycle";
import { parseDbDate } from "@/lib/time";

const OUTCOME_WEIGHT: Record<string, number> = {
  GOOD: 1.0,
  SPIKE: 0.7,
  UNDERDOSE: 0.3,
  OVERDOSE: 0.3,
  CHECK_CONTEXT: 0.5,
};

export type TimeOfDay = "morning" | "afternoon" | "evening";

export interface AdaptiveICR {
  global: number | null;
  morning: number | null;
  afternoon: number | null;
  evening: number | null;
  sampleSize: number;
}

function timeOfDay(d: Date): TimeOfDay {
  const h = d.getHours();
  if (h < 11) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function weightedAverage(samples: { value: number; weight: number }[]): number | null {
  if (!samples.length) return null;
  const w = samples.reduce((s, x) => s + x.weight, 0);
  if (w <= 0) return null;
  const v = samples.reduce((s, x) => s + x.value * x.weight, 0);
  return v / w;
}

/**
 * Builds an adaptive insulin-to-carb ratio from finalized meals.
 * Output unit: grams of carb per 1u of insulin.
 */
export function computeAdaptiveICR(meals: Meal[]): AdaptiveICR {
  const buckets: Record<"all" | TimeOfDay, { value: number; weight: number }[]> = {
    all: [], morning: [], afternoon: [], evening: [],
  };

  for (const m of meals) {
    const lc = lifecycleFor(m);
    if (lc.state !== "final") continue;
    const carbs = m.carbs_grams ?? 0;
    const insulin = m.insulin_units ?? 0;
    if (carbs <= 0 || insulin <= 0) continue;
    const w = OUTCOME_WEIGHT[lc.outcome ?? "GOOD"] ?? 0.5;
    if (w <= 0) continue;
    const ratio = carbs / insulin;
    buckets.all.push({ value: ratio, weight: w });
    buckets[timeOfDay(parseDbDate(m.meal_time ?? m.created_at))].push({ value: ratio, weight: w });
  }

  return {
    global:    weightedAverage(buckets.all),
    morning:   buckets.morning.length   >= 3 ? weightedAverage(buckets.morning)   : null,
    afternoon: buckets.afternoon.length >= 3 ? weightedAverage(buckets.afternoon) : null,
    evening:   buckets.evening.length   >= 3 ? weightedAverage(buckets.evening)   : null,
    sampleSize: buckets.all.length,
  };
}
