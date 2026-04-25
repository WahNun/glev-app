/**
 * Bolus ↔ Meal pairing for engine ICR computations.
 *
 * Two pairing sources, in order of preference:
 *   1. Explicit user tag — `insulin_logs.related_entry_id` set via the
 *      "Zu Mahlzeit verknüpfen" dropdown in the Bolus log dialog.
 *   2. Time-window heuristic — closest meal within ±30 min of the bolus'
 *      `created_at`, used only when no explicit tag exists.
 *
 * Each meal pairs at most once, each bolus pairs at most once. Explicit
 * links always win against time-window candidates so the user's intent
 * overrides proximity.
 */

import type { InsulinLog } from "@/lib/insulin";
import type { Meal } from "@/lib/meals";
import { parseDbDate, parseDbTs } from "@/lib/time";

export const BOLUS_MEAL_WINDOW_MS = 30 * 60 * 1000;

export interface BolusMealPair {
  bolus: InsulinLog;
  meal: Meal;
  /** "explicit" if user-tagged via related_entry_id; "time-window" if
   *  matched by ≤30min proximity heuristic. */
  source: "explicit" | "time-window";
  /** Absolute time delta in ms between bolus.created_at and the meal's
   *  meal_time (or created_at). Always 0 for explicit links — the user
   *  has declared the pairing regardless of timing. */
  deltaMs: number;
}

function mealTime(m: Meal): number {
  return parseDbDate(m.meal_time ?? m.created_at).getTime();
}

/**
 * Pair a single bolus log to a meal. Returns null when the entry isn't
 * a bolus or no candidate meal exists.
 */
export function pairBolusToMeal(bolus: InsulinLog, meals: Meal[]): BolusMealPair | null {
  if (bolus.insulin_type !== "bolus") return null;

  if (bolus.related_entry_id) {
    const tagged = meals.find(m => m.id === bolus.related_entry_id);
    if (tagged) return { bolus, meal: tagged, source: "explicit", deltaMs: 0 };
  }

  const bolusTs = parseDbTs(bolus.created_at);
  if (!Number.isFinite(bolusTs)) return null;

  let bestMeal: Meal | null = null;
  let bestDelta = Infinity;
  for (const m of meals) {
    const delta = Math.abs(mealTime(m) - bolusTs);
    if (delta <= BOLUS_MEAL_WINDOW_MS && delta < bestDelta) {
      bestDelta = delta;
      bestMeal = m;
    }
  }
  return bestMeal ? { bolus, meal: bestMeal, source: "time-window", deltaMs: bestDelta } : null;
}

/**
 * Build all bolus↔meal pairs across the given window. Two-pass:
 *   Pass 1: explicit tags (related_entry_id), one pair each.
 *   Pass 2: time-window candidates ranked globally by smallest |Δt|, then
 *           greedily assigned so each bolus & meal participates at most
 *           once (the closest pair wins).
 *
 * Suitable as input for adaptive ICR / pattern detection that needs to
 * attribute a specific bolus dose to a specific meal's carbs.
 */
export function pairBolusesToMeals(boluses: InsulinLog[], meals: Meal[]): BolusMealPair[] {
  const pairs: BolusMealPair[] = [];
  const usedMealIds = new Set<string>();
  const usedBolusIds = new Set<string>();

  for (const b of boluses) {
    if (b.insulin_type !== "bolus" || !b.related_entry_id) continue;
    if (usedBolusIds.has(b.id)) continue;
    const m = meals.find(x => x.id === b.related_entry_id);
    if (!m || usedMealIds.has(m.id)) continue;
    pairs.push({ bolus: b, meal: m, source: "explicit", deltaMs: 0 });
    usedMealIds.add(m.id);
    usedBolusIds.add(b.id);
  }

  type Cand = { bolus: InsulinLog; meal: Meal; delta: number };
  const cands: Cand[] = [];
  for (const b of boluses) {
    if (b.insulin_type !== "bolus" || usedBolusIds.has(b.id)) continue;
    const bTs = parseDbTs(b.created_at);
    if (!Number.isFinite(bTs)) continue;
    for (const m of meals) {
      if (usedMealIds.has(m.id)) continue;
      const delta = Math.abs(mealTime(m) - bTs);
      if (delta <= BOLUS_MEAL_WINDOW_MS) cands.push({ bolus: b, meal: m, delta });
    }
  }
  cands.sort((a, b) => a.delta - b.delta);
  for (const c of cands) {
    if (usedBolusIds.has(c.bolus.id) || usedMealIds.has(c.meal.id)) continue;
    pairs.push({ bolus: c.bolus, meal: c.meal, source: "time-window", deltaMs: c.delta });
    usedBolusIds.add(c.bolus.id);
    usedMealIds.add(c.meal.id);
  }

  return pairs;
}
