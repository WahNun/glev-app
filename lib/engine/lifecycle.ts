import type { Meal } from "@/lib/meals";
import { evaluateEntry, type Outcome } from "./evaluation";

export type OutcomeState = "pending" | "provisional" | "final";

export const STATE_LABELS: Record<OutcomeState, string> = {
  pending: "Awaiting glucose data",
  provisional: "Preliminary result (updates after 2h)",
  final: "Final outcome",
};

export interface LifecycleResult {
  state: OutcomeState;
  outcome: Outcome | null;
  reasoning: string;
  delta1: number | null;   // bg1h - bgBefore   (not yet wired in DB; reserved)
  delta2: number | null;   // bg2h - bgBefore   (uses glucose_after)
  ageMinutes: number;
}

const ONE_HOUR = 60;
const TWO_HOURS = 120;

/**
 * Pending → Provisional → Final.
 * The DB does not yet carry bg1h, only glucose_after (treated as bg2h).
 * Until bg1h is captured, the lifecycle is age-driven for entries
 * without a post-meal reading.
 */
export function lifecycleFor(m: Meal, now: Date = new Date()): LifecycleResult {
  const created = new Date(m.created_at);
  const ageMinutes = Math.max(0, (now.getTime() - created.getTime()) / 60000);
  const bgBefore = m.glucose_before;
  const bg2h     = m.glucose_after;
  const delta2   = bgBefore != null && bg2h != null ? bg2h - bgBefore : null;

  // Only treat a post-meal reading as "final" once enough time has elapsed
  // (glucose_after has no timestamp column in the current schema, so we use
  // meal-age as a proxy). Anything earlier is still provisional.
  if (bg2h != null && bgBefore != null && ageMinutes >= TWO_HOURS) {
    const ev = evaluateEntry({
      carbs: m.carbs_grams ?? 0,
      protein: m.protein_grams ?? 0,
      fat: m.fat_grams ?? 0,
      fiber: m.fiber_grams ?? 0,
      insulin: m.insulin_units ?? 0,
      bgBefore,
      bgAfter: bg2h,
      classification: (m.meal_type as "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED" | null) ?? undefined,
    });
    return { state: "final", outcome: ev.outcome, reasoning: ev.reasoning, delta1: null, delta2, ageMinutes };
  }

  if (ageMinutes < ONE_HOUR) {
    return { state: "pending", outcome: null, reasoning: "Awaiting 1-hour glucose check.", delta1: null, delta2: null, ageMinutes };
  }
  if (ageMinutes < TWO_HOURS) {
    // Provisional based on dose ratio (no post-meal reading yet).
    const ev = evaluateEntry({
      carbs: m.carbs_grams ?? 0,
      protein: m.protein_grams ?? 0,
      fat: m.fat_grams ?? 0,
      fiber: m.fiber_grams ?? 0,
      insulin: m.insulin_units ?? 0,
      bgBefore,
      bgAfter: null,
      classification: (m.meal_type as "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED" | null) ?? undefined,
    });
    return { state: "provisional", outcome: ev.outcome, reasoning: `${ev.reasoning} Updates after 2-hour reading.`, delta1: null, delta2: null, ageMinutes };
  }

  // > 2h with no post-meal reading: still provisional, low-confidence ICR fallback.
  const ev = evaluateEntry({
    carbs: m.carbs_grams ?? 0,
    protein: m.protein_grams ?? 0,
    fat: m.fat_grams ?? 0,
    fiber: m.fiber_grams ?? 0,
    insulin: m.insulin_units ?? 0,
    bgBefore,
    bgAfter: null,
    classification: (m.meal_type as "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED" | null) ?? undefined,
  });
  return { state: "provisional", outcome: ev.outcome, reasoning: `${ev.reasoning} (no post-meal reading captured)`, delta1: null, delta2: null, ageMinutes };
}
