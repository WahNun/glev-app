import type { Meal } from "@/lib/meals";
import type { InsulinLog } from "@/lib/insulin";
import { lifecycleFor } from "./lifecycle";
import { parseDbDate } from "@/lib/time";
import { pairBolusesToMeals } from "./pairing";

const OUTCOME_WEIGHT: Record<string, number> = {
  GOOD: 1.0,
  SPIKE: 0.7,
  UNDERDOSE: 0.3,
  OVERDOSE: 0.3,
};

export type TimeOfDay = "morning" | "afternoon" | "evening";

export interface AdaptiveICR {
  global: number | null;
  morning: number | null;
  afternoon: number | null;
  evening: number | null;
  sampleSize: number;
  /** How many of the contributing meals took their insulin value from a
   *  paired bolus log (explicit `related_entry_id` tag OR ±30-min
   *  time-window pair). The remainder (`sampleSize - pairedCount`) used
   *  the legacy `meal.insulin_units` column. Surfaced in the UI so the
   *  user can see whether their ICR is driven by separately-logged
   *  bolus shots or by the meal's own insulin field. */
  pairedCount: number;
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
 *
 * When `boluses` is provided, the function pairs the bolus logs to the
 * meals via `pairBolusesToMeals` (explicit `related_entry_id` first,
 * then ±30 min time-window heuristic) and uses the SUM of paired bolus
 * units as the insulin value for that meal — this lets users who log
 * boluses separately from meals (or split a meal across multiple shots)
 * still feed the engine their real dosing behaviour. Meals without a
 * bolus pair fall back to `meal.insulin_units`. When `boluses` is
 * omitted the legacy meal.insulin_units-only behaviour is preserved.
 */
export function computeAdaptiveICR(meals: Meal[], boluses?: InsulinLog[]): AdaptiveICR {
  const buckets: Record<"all" | TimeOfDay, { value: number; weight: number }[]> = {
    all: [], morning: [], afternoon: [], evening: [],
  };

  // Build meal-id → summed bolus units map.
  //
  // We can't use pairBolusesToMeals alone because it enforces 1:1 pairing
  // (each meal accepts at most one bolus), and that would silently drop
  // user-split doses (pre-bolus + correction shot for the same meal,
  // both explicitly tagged). For the adaptive ICR we need the user's
  // *full* injected dose for that meal, not just one shot of it.
  //
  // Strategy:
  //   1. Group ALL explicit-tagged boluses (related_entry_id) by meal id
  //      and sum their units — this captures the split-bolus case.
  //   2. For meals that have NO explicit-tagged bolus, fall back to the
  //      time-window pairing helper (still 1:1) so heuristic matches
  //      keep working.
  //
  // Basal entries are filtered out at every stage so a basal log
  // mistakenly tagged to a meal can never inflate the ICR.
  const bolusUnitsByMealId = new Map<string, number>();
  if (boluses && boluses.length > 0) {
    const mealIds = new Set(meals.map(m => m.id));
    const explicitTagged: InsulinLog[] = [];
    const untagged:        InsulinLog[] = [];
    for (const b of boluses) {
      if (b.insulin_type !== "bolus") continue;
      if (b.related_entry_id && mealIds.has(b.related_entry_id)) {
        explicitTagged.push(b);
      } else {
        // Includes truly-untagged boluses AND tagged boluses whose
        // target meal isn't in the current set (out of window) — both
        // are eligible for time-window pairing within the window.
        untagged.push({ ...b, related_entry_id: null });
      }
    }
    // Pass 1: sum every explicit-tagged bolus for its target meal.
    for (const b of explicitTagged) {
      const cur = bolusUnitsByMealId.get(b.related_entry_id!) ?? 0;
      bolusUnitsByMealId.set(b.related_entry_id!, cur + (b.units || 0));
    }
    // Pass 2: for meals not already covered by an explicit tag, run
    // the standard pair helper on the remaining (un-tagged) boluses.
    const uncoveredMeals = meals.filter(m => !bolusUnitsByMealId.has(m.id));
    if (uncoveredMeals.length > 0 && untagged.length > 0) {
      const pairs = pairBolusesToMeals(untagged, uncoveredMeals);
      for (const p of pairs) {
        bolusUnitsByMealId.set(p.meal.id, (p.bolus.units || 0));
      }
    }
  }

  let pairedCount = 0;
  for (const m of meals) {
    const lc = lifecycleFor(m);
    if (lc.state !== "final") continue;
    const carbs = m.carbs_grams ?? 0;
    if (carbs <= 0) continue;

    const pairedInsulin = bolusUnitsByMealId.get(m.id);
    let insulin: number;
    let usedPair = false;
    if (pairedInsulin !== undefined && pairedInsulin > 0) {
      // Meal has at least one paired bolus — use the sum, ignoring
      // meal.insulin_units (the user's standalone bolus log is the
      // source of truth for what they actually injected).
      insulin = pairedInsulin;
      usedPair = true;
    } else {
      // No bolus pair → fall back to the legacy meal.insulin_units.
      // Per spec, a meal with no pair only contributes when its own
      // insulin_units is > 0.
      insulin = m.insulin_units ?? 0;
    }
    if (insulin <= 0) continue;

    const w = OUTCOME_WEIGHT[lc.outcome ?? "GOOD"] ?? 0.5;
    if (w <= 0) continue;
    const ratio = carbs / insulin;
    buckets.all.push({ value: ratio, weight: w });
    buckets[timeOfDay(parseDbDate(m.meal_time ?? m.created_at))].push({ value: ratio, weight: w });
    if (usedPair) pairedCount++;
  }

  return {
    global:    weightedAverage(buckets.all),
    morning:   buckets.morning.length   >= 3 ? weightedAverage(buckets.morning)   : null,
    afternoon: buckets.afternoon.length >= 3 ? weightedAverage(buckets.afternoon) : null,
    evening:   buckets.evening.length   >= 3 ? weightedAverage(buckets.evening)   : null,
    sampleSize: buckets.all.length,
    pairedCount,
  };
}
