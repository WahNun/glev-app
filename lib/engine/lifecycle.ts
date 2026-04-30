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
  /** True when the bg_1h or bg_2h reading lies outside the ±30 min
   *  validation window from its expected capture time. When set, the
   *  lifecycle returns `outcome: null` and `state: "provisional"` —
   *  the reading is dropped from outcome inference and the reasoning
   *  string carries the actual gap (e.g. "Reading outside expected
   *  window (actual gap: +47 min) — outcome cannot be reliably
   *  determined.") so the entries page can show the user why the
   *  meal stayed un-classified. */
  outOfWindow: boolean;
}

const ONE_HOUR = 60;
const TWO_HOURS = 120;
const WINDOW_TOLERANCE_MIN = 30;

/**
 * Returns the wall-clock gap (minutes) between when a reading was
 * captured and when it was expected. Positive = late, negative = early.
 * Returns null when either timestamp is missing / unparseable.
 */
function gapFromExpected(capturedAtIso: string | null, mealMs: number, expectedOffsetMin: number): number | null {
  if (!capturedAtIso) return null;
  const t = Date.parse(capturedAtIso);
  if (!isFinite(t)) return null;
  const expected = mealMs + expectedOffsetMin * 60_000;
  return Math.round((t - expected) / 60_000);
}

function classify(m: Meal) {
  return (m.meal_type as "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED" | null) ?? undefined;
}

/**
 * Pending → Provisional → Final.
 *
 * A non-null bg_2h reading captured WITHIN ±30 min of `meal_time +
 * 120min` locks the row to its final GOOD / SPIKE / UNDERDOSE /
 * OVERDOSE verdict (Task #15: the previous "trust the bg_2h
 * unconditionally" behaviour silently mis-classified rows where the
 * user logged a reading hours late). When the captured-at timestamp
 * sits outside the ±30 min tolerance, the reading is dropped from
 * outcome inference: state stays `provisional`, `outcome` becomes
 * `null`, and `reasoning` carries the actual gap. Same window guard
 * applies to bg_1h.
 *
 * `glucose_after` is still accepted as a legacy bg_2h proxy for rows
 * predating the bg_2h column (no captured-at, so the window check is
 * skipped for that path). Pure function — no timers.
 *
 * @param settings Optional personal ICR/CF/target — when omitted, the
 *                 evaluator falls back to getInsulinSettings(). The
 *                 async writeback paths (lib/meals.updateMealReadings,
 *                 ManualEntryModal save handler, postMealCgmAutoFill)
 *                 pass an explicit `await fetchInsulinSettings()` so
 *                 the no-bgAfter ICR-ratio fallback uses the user's
 *                 DB-backed personal ratios.
 */
export function lifecycleFor(m: Meal, now: Date = new Date(), settings?: InsulinSettings): LifecycleResult {
  const created = parseDbDate(m.meal_time ?? m.created_at);
  const mealMs = created.getTime();
  const ageMinutes = Math.max(0, (now.getTime() - mealMs) / 60000);
  const bgBefore = m.glucose_before;
  const bg1h     = m.bg_1h;
  const bg2hRaw  = m.bg_2h ?? m.glucose_after; // fallback for legacy rows
  const delta1   = bgBefore != null && bg1h     != null ? bg1h     - bgBefore : null;
  const delta2   = bgBefore != null && bg2hRaw  != null ? bg2hRaw  - bgBefore : null;
  const speed1   = delta1 != null ? delta1 / 60  : null;
  const speed2   = delta2 != null ? delta2 / 120 : null;

  // ±30 min validation window for the captured-at timestamps. We only
  // check actual gaps when the row carries a captured-at — legacy rows
  // (and the glucose_after fallback path) skip the window check.
  const gap1h = bg1h != null ? gapFromExpected(m.bg_1h_at, mealMs, ONE_HOUR) : null;
  const gap2h = bg2hRaw != null && m.bg_2h != null ? gapFromExpected(m.bg_2h_at, mealMs, TWO_HOURS) : null;
  const out1h = gap1h != null && Math.abs(gap1h) > WINDOW_TOLERANCE_MIN;
  const out2h = gap2h != null && Math.abs(gap2h) > WINDOW_TOLERANCE_MIN;

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

  // Final: bg2h present. Trust it unconditionally — UNLESS the actual
  // capture timestamp lies more than ±30 min from `meal_time + 120min`,
  // in which case the spec requires us to NOT classify (`outcome: null`,
  // `state: "provisional"`) and surface the gap so the user knows why.
  // The historical "trust whatever is in bg_2h" behaviour silently
  // mis-classified rows where the user logged a reading hours late.
  if (bg2hRaw != null && bgBefore != null) {
    if (out2h) {
      return {
        state:    "provisional",
        outcome:  null,
        reasoning: `Reading outside expected window (actual gap: ${gap2h! >= 0 ? "+" : ""}${gap2h} min) — outcome cannot be reliably determined.`,
        delta1, delta2, speed1, speed2, ageMinutes,
        outOfWindow: true,
      };
    }
    const ev = baseEval(bg2hRaw);
    return { state: "final", outcome: ev.outcome, reasoning: ev.reasoning, delta1, delta2, speed1, speed2, ageMinutes, outOfWindow: false };
  }

  // Provisional: bg1h present. Direction-only readout until bg2h lands.
  // Same out-of-window guard as bg2h above — the reading is dropped
  // from outcome inference but the gap is surfaced in `reasoning`.
  if (bg1h != null && bgBefore != null) {
    if (out1h) {
      return {
        state:    "provisional",
        outcome:  null,
        reasoning: `Reading outside expected window (actual gap: ${gap1h! >= 0 ? "+" : ""}${gap1h} min) — outcome cannot be reliably determined.`,
        delta1, delta2, speed1, speed2, ageMinutes,
        outOfWindow: true,
      };
    }
    const ev = baseEval(bg1h);
    const isEarly = ageMinutes < ONE_HOUR;
    const window = isEarly ? `early check at ${Math.round(ageMinutes)} min` : "1-hour check";
    const reason = `${window}: Δ ${delta1! > 0 ? "+" : ""}${delta1} mg/dL. Preliminary direction only — updates after the 2-hour reading. ${ev.reasoning}`;
    return { state: "provisional", outcome: ev.outcome, reasoning: reason, delta1, delta2, speed1, speed2, ageMinutes, outOfWindow: false };
  }

  if (ageMinutes < ONE_HOUR) {
    return { state: "pending", outcome: null, reasoning: "Awaiting 1-hour glucose check.", delta1, delta2, speed1, speed2, ageMinutes, outOfWindow: false };
  }

  // 60–120 min with no bg1h, or older with no readings: provisional via dose ratio.
  const ev = baseEval(null);
  const note = ageMinutes >= TWO_HOURS ? "(no post-meal reading captured)" : "Updates after 2-hour reading.";
  return { state: "provisional", outcome: ev.outcome, reasoning: `${ev.reasoning} ${note}`, delta1, delta2, speed1, speed2, ageMinutes, outOfWindow: false };
}
