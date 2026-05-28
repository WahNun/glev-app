/**
 * reconcileEvaluation — write-side reconcile helper (Task #261).
 *
 * Encapsulates the decision logic used by `app/api/cgm-jobs/process/route.ts`
 * to determine whether the cached `meals.evaluation` column needs to be
 * overwritten after a curve backfill has populated the window aggregates.
 *
 * Why extracted:
 *   The inline route code was previously un-testable without a full HTTP
 *   round-trip.  Extracting the pure decision function lets unit tests
 *   verify that a DB write IS triggered when `lifecycleFor` returns a
 *   different outcome than the stale cache (e.g. HYPO_DURING vs GOOD).
 *
 * Contract:
 *   - `nextEval` is the outcome the engine computed right now.
 *     It is `null` when the state is not "final" (pending / provisional)
 *     — in that case the cache should be cleared so users don't see a
 *     stale "GOOD" on a provisional meal.
 *   - `cachedEval` mirrors `meal.evaluation` for comparison.
 *   - `shouldWrite` is `true` whenever the two values differ — the caller
 *     must issue an UPDATE to `meals.evaluation` when this is true.
 */

import type { Meal } from "@/lib/meals";
import { lifecycleFor } from "./lifecycle";
import type { TrendSample } from "./trend";

export interface ReconcileResult {
  /** Outcome computed by the live engine; null when state ≠ "final". */
  nextEval: string | null;
  /** The current DB-cached value (`meal.evaluation`). */
  cachedEval: string | null;
  /** True when nextEval ≠ cachedEval — caller must UPDATE the DB row. */
  shouldWrite: boolean;
}

/**
 * @param meal           Full meal row including curve aggregates.
 * @param preMealSamples Optional pre-meal CGM samples (last 15 min before
 *                       meal_time). Pass these from the cgm-jobs reconcile
 *                       path; omit for read-side callers who don't have them.
 */
export function reconcileEvaluation(
  meal: Meal,
  preMealSamples?: readonly TrendSample[],
): ReconcileResult {
  const lc = lifecycleFor(meal, undefined, undefined, preMealSamples);
  const nextEval = lc.state === "final" ? lc.outcome : null;
  const cachedEval = meal.evaluation;
  return {
    nextEval,
    cachedEval,
    shouldWrite: nextEval !== cachedEval,
  };
}
