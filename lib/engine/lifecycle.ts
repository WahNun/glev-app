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
/**
 * Tolerance window (minutes) around the expected 1h / 2h checkpoint.
 * A reading captured within ±30 min of meal_time + 60 / 120 counts as
 * the canonical 1h / 2h reading. Outside that window it still feeds
 * delta / speed display but the outcome is held provisional with an
 * explicit "outside expected window" note so the user understands why.
 */
const CHECKPOINT_TOLERANCE_MIN = 30;

function classify(m: Meal) {
  return (m.meal_type as "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED" | null) ?? undefined;
}

/** Minutes between two ISO timestamps, or null if either is missing/unparsable. */
function minutesBetween(aIso: string | null | undefined, bMs: number): number | null {
  if (!aIso) return null;
  const a = parseDbDate(aIso).getTime();
  if (!Number.isFinite(a)) return null;
  return (a - bMs) / 60000;
}

/**
 * Pending → Provisional → Final.
 *
 * Reads bg_1h / bg_2h with bg_*_at timestamps. Both readings are
 * validated against meal_time + 60 / 120 min within ±30 min tolerance:
 *   - Inside the window → counts as the canonical checkpoint.
 *   - Outside the window → outcome held provisional with a reasoning
 *     note that explains the timing gap, so a 4-hour-late "2h" reading
 *     does not silently lock in a final label.
 *
 * `glucose_after` is still accepted as a legacy bg_2h proxy for rows
 * predating the bg_2h_at column. Pure function — no timers.
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

  // Time-gap validation against the expected checkpoints.
  // Only validate when the row HAS a captured-at timestamp; legacy rows
  // (bg_*_at = null) keep the old behaviour and trust the value.
  const gap1Min = m.bg_1h != null ? minutesBetween(m.bg_1h_at, created.getTime() + ONE_HOUR  * 60_000) : null;
  const gap2Min = m.bg_2h != null ? minutesBetween(m.bg_2h_at, created.getTime() + TWO_HOURS * 60_000) : null;
  const bg1hInWindow = gap1Min == null || Math.abs(gap1Min) <= CHECKPOINT_TOLERANCE_MIN;
  const bg2hInWindow = gap2Min == null || Math.abs(gap2Min) <= CHECKPOINT_TOLERANCE_MIN;

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

  // Final: bg2h captured in-window AND enough time has passed.
  if (bg2hRaw != null && bgBefore != null && ageMinutes >= TWO_HOURS && bg2hInWindow) {
    const ev = baseEval(bg2hRaw);
    return { state: "final", outcome: ev.outcome, reasoning: ev.reasoning, delta1, delta2, speed1, speed2, ageMinutes };
  }

  // bg2h captured but OUTSIDE the ±30 min window — held provisional with
  // an explicit timing note so the user sees why the outcome is not final.
  if (bg2hRaw != null && bgBefore != null && !bg2hInWindow && gap2Min != null) {
    const ev = baseEval(bg2hRaw);
    const direction = gap2Min > 0 ? "after" : "before";
    const offset = Math.round(Math.abs(gap2Min));
    const note = `2h reading captured ${offset} min ${direction} the expected 2-hour mark — outside the ±${CHECKPOINT_TOLERANCE_MIN} min window, so result stays provisional. ${ev.reasoning}`;
    return { state: "provisional", outcome: ev.outcome, reasoning: note, delta1, delta2, speed1, speed2, ageMinutes };
  }

  // Provisional: bg1h captured. Validate timing too — an out-of-window
  // 1h reading still feeds the chip but the wording flags the gap.
  if (bg1h != null && bgBefore != null) {
    const ev = baseEval(bg1h);
    const isEarly = ageMinutes < ONE_HOUR;
    let window: string;
    if (gap1Min != null && !bg1hInWindow) {
      const direction = gap1Min > 0 ? "after" : "before";
      const offset = Math.round(Math.abs(gap1Min));
      window = `1h reading ${offset} min ${direction} the expected 1-hour mark (outside ±${CHECKPOINT_TOLERANCE_MIN} min window)`;
    } else {
      window = isEarly ? `early check at ${Math.round(ageMinutes)} min` : "1-hour check";
    }
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
