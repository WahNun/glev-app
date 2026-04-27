import type { Meal } from "@/lib/meals";
import { evaluateEntry, type Outcome } from "./evaluation";
import { parseDbDate } from "@/lib/time";
import type { InsulinSettings } from "@/lib/userSettings";

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
  delta1: number | null;        // bg1h - bgBefore
  delta2: number | null;        // bg2h - bgBefore
  speed1: number | null;        // mg/dL per minute over first 60min
  speed2: number | null;        // mg/dL per minute over 120min
  ageMinutes: number;
}

const ONE_HOUR = 60;
const TWO_HOURS = 120;

function classify(m: Meal) {
  return (m.meal_type as "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED" | null) ?? undefined;
}

/**
 * Pending → Provisional → Final.
 *
 * Per user spec: ANY non-null bg_2h reading immediately locks the chip
 * to its final GOOD / HIGH / LOW verdict — no timing-window gating.
 * Same for bg_1h flipping the chip out of "pending" into "provisional".
 * The captured-at columns (bg_*_at) are still in the row for audit /
 * future analytics, but the lifecycle no longer reads them. CGM
 * autofill (lib/postMealCgmAutoFill.ts) is the right place to gate
 * which CGM reading is chosen — once a value lands in bg_2h, this
 * function trusts it.
 *
 * `glucose_after` is still accepted as a legacy bg_2h proxy for rows
 * predating the bg_2h column. Pure function — no timers.
 *
 * @param settings Optional personal ICR/CF/target — when omitted, the
 *                 evaluator falls back to getInsulinSettings().
 */
export function lifecycleFor(m: Meal, now: Date = new Date(), settings?: InsulinSettings): LifecycleResult {
  const created = parseDbDate(m.meal_time ?? m.created_at);
  const ageMinutes = Math.max(0, (now.getTime() - created.getTime()) / 60000);
  const bgBefore = m.glucose_before;
  const bg1h     = m.bg_1h;
  const bg2hRaw  = m.bg_2h ?? m.glucose_after; // fallback for legacy rows
  const delta1   = bgBefore != null && bg1h     != null ? bg1h     - bgBefore : null;
  const delta2   = bgBefore != null && bg2hRaw  != null ? bg2hRaw  - bgBefore : null;
  const speed1   = delta1 != null ? delta1 / 60  : null;
  const speed2   = delta2 != null ? delta2 / 120 : null;

  const baseEval = (afterValue: number | null) => evaluateEntry({
    carbs:    m.carbs_grams ?? 0,
    protein:  m.protein_grams ?? 0,
    fat:      m.fat_grams ?? 0,
    fiber:    m.fiber_grams ?? 0,
    insulin:  m.insulin_units ?? 0,
    bgBefore,
    bgAfter:  afterValue,
    classification: classify(m),
    speed1,
    speed2,
    settings,
  });

  // Final: bg2h present. Trust it unconditionally — see header comment.
  if (bg2hRaw != null && bgBefore != null) {
    const ev = baseEval(bg2hRaw);
    return { state: "final", outcome: ev.outcome, reasoning: ev.reasoning, delta1, delta2, speed1, speed2, ageMinutes };
  }

  // Provisional: bg1h present. Direction-only readout until bg2h lands.
  if (bg1h != null && bgBefore != null) {
    const ev = baseEval(bg1h);
    const isEarly = ageMinutes < ONE_HOUR;
    const window = isEarly ? `early check at ${Math.round(ageMinutes)} min` : "1-hour check";
    const reason = `${window}: Δ ${delta1! > 0 ? "+" : ""}${delta1} mg/dL. Preliminary direction only — updates after the 2-hour reading. ${ev.reasoning}`;
    return { state: "provisional", outcome: ev.outcome, reasoning: reason, delta1, delta2, speed1, speed2, ageMinutes };
  }

  if (ageMinutes < ONE_HOUR) {
    return { state: "pending", outcome: null, reasoning: "Awaiting 1-hour glucose check.", delta1, delta2, speed1, speed2, ageMinutes };
  }

  // 60–120 min with no bg1h, or older with no readings: provisional via dose ratio.
  const ev = baseEval(null);
  const note = ageMinutes >= TWO_HOURS ? "(no post-meal reading captured)" : "Updates after 2-hour reading.";
  return { state: "provisional", outcome: ev.outcome, reasoning: `${ev.reasoning} ${note}`, delta1, delta2, speed1, speed2, ageMinutes };
}
