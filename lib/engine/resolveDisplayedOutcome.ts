/**
 * resolveDisplayedOutcome — read-side reconcile helper (Task #261).
 *
 * The entries page and any future read surface that shows a meal outcome
 * MUST call this instead of reading `meal.evaluation` directly.
 *
 * `meal.evaluation` is a write-time DB cache.  After a +3h curve backfill
 * (Task #187) the live `lifecycleFor` result can flip (e.g. HYPO_DURING,
 * peak-SPIKE) while the column still holds the old bg_2h-delta verdict.
 * Using `meal.evaluation` directly would cause the chip and the OUTCOME
 * card to disagree (the bug fixed by Task #253).
 *
 * Signature accepts the ALREADY-COMPUTED LifecycleResult so the caller
 * (entries/page.tsx) can reuse the same object for both the chip and the
 * displayed outcome without running `lifecycleFor` twice.
 *
 * Contract:
 *   - Returns `lc.outcome` when the engine has a definitive verdict
 *     (curve present OR bg_2h inside window).
 *   - Falls back to `meal.evaluation` only when the lifecycle is pending /
 *     outside-window / pre-curve (i.e. `lc.outcome === null`).
 *   - Returns `null` when neither source has an outcome yet.
 */

import type { LifecycleResult } from "./lifecycle";
import type { Meal } from "@/lib/meals";

export function resolveDisplayedOutcome(lc: LifecycleResult, meal: Meal): string | null {
  return lc.outcome ?? meal.evaluation;
}
