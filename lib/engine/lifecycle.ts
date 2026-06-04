import type { Meal } from "@/lib/meals";
import { evaluateEntry, type Outcome } from "./evaluation";
import type { AdjustmentMessage } from "./adjustment";
import { parseDbDate } from "@/lib/time";
import type { InsulinSettings } from "@/lib/userSettings";
import { classifyPreReferenceTrend, type TrendSample } from "./trend";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves the total alcohol grams from influence_logs within the
 * 8-hour window before `mealMs` for the given user.
 *
 * Trigger is on the INFLUENCE, not on meal-linkage:
 *   - source_meal_id NULL  (standalone alcohol influence) → included
 *   - source_meal_id set   (linked to a meal)             → included
 *
 * Returns 0 when no alcohol influence exists in the window, or when
 * the query fails (non-fatal — evaluation proceeds without the tag).
 */
export async function resolveLinkedAlcohol(
  sb: SupabaseClient,
  userId: string,
  mealMs: number,
): Promise<number> {
  try {
    const windowStart = new Date(mealMs - 8 * 3600_000).toISOString();
    const windowEnd   = new Date(mealMs + 8 * 3600_000).toISOString();
    const { data } = await sb
      .from("influence_logs")
      .select("alcohol_g")
      .eq("user_id", userId)
      .eq("influence_type", "alcohol")
      .gte("occurred_at", windowStart)
      .lte("occurred_at", windowEnd);
    if (!data || data.length === 0) return 0;
    return (data as Array<{ alcohol_g: number | null }>).reduce(
      (sum, row) => sum + (typeof row.alcohol_g === "number" && row.alcohol_g > 0 ? row.alcohol_g : 0),
      0,
    );
  } catch {
    return 0;
  }
}

export type OutcomeState = "pending" | "provisional" | "final";

export const STATE_LABELS: Record<OutcomeState, string> = {
  pending: "Awaiting glucose data",
  provisional: "Preliminary result (updates after 2h)",
  final: "Final outcome",
};

export interface LifecycleResult {
  state: OutcomeState;
  outcome: Outcome | null;
  /** Localizable reasoning — render each entry with `t(m.key, m.params)`. */
  messages: AdjustmentMessage[];
  delta1: number | null;
  delta2: number | null;
  speed1: number | null;
  speed2: number | null;
  ageMinutes: number;
  outOfWindow: boolean;
}

const ONE_HOUR = 60;
const TWO_HOURS = 120;
const WINDOW_TOLERANCE_MIN = 30;

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

function gapParam(gap: number): string {
  return `${gap >= 0 ? "+" : ""}${gap}`;
}

export function lifecycleFor(
  m: Meal,
  now: Date = new Date(),
  settings?: InsulinSettings,
  /** CGM samples from the 15-minute pre-meal window. When provided,
   *  `classifyPreReferenceTrend` computes a regression-based TrendClass
   *  that is forwarded into `evaluateEntry({ preTrend })` so the
   *  reasoning bullet appears on finalized meals in Insights / Entry-Log.
   *  Pass `undefined` (or omit) when no CGM history is available — the
   *  evaluation path is identical to before this parameter existed. */
  preMealSamples?: readonly TrendSample[],
  /** Total alcohol grams from any alcohol influence_log within the last
   *  8 h of this meal — trigger is on the influence, NOT on meal-linkage.
   *  source_meal_id may be NULL (standalone influence) or set (linked).
   *  When > 0, evaluateEntry tags HYPO_DURING with [alcohol_extended_window].
   *  Resolved by server-side callers via a separate influence_logs query.
   *  Optional — when omitted, behaviour is identical to the pre-alcohol path. */
  linkedAlcoholG?: number | null,
): LifecycleResult {
  const created = parseDbDate(m.meal_time ?? m.created_at);
  const mealMs = created.getTime();

  const preTrend = preMealSamples
    ? classifyPreReferenceTrend(preMealSamples, mealMs)?.trend
    : undefined;
  const ageMinutes = Math.max(0, (now.getTime() - mealMs) / 60000);
  const bgBefore = m.glucose_before;
  // Post-Meal Granularität fix: cascade to new glucose_* columns written by
  // PendingGlucoseStrip / CgmAutoFillProvider (5-timepoint schema added
  // 2026-04-29). The legacy bg_1h / bg_2h columns remain the primary source
  // for backwards compatibility; new reads entered via the badge land in
  // glucose_1h / glucose_2h and must feed the evaluator too.
  const bg1h        = m.bg_1h ?? m.glucose_1h;
  const bg1h_at_str = m.bg_1h != null ? m.bg_1h_at : m.glucose_1h_at;
  const bg2hRaw     = m.bg_2h ?? m.glucose_2h ?? m.glucose_after;
  const has_bg2h    = m.bg_2h != null || m.glucose_2h != null;
  const bg2h_at_str = m.bg_2h != null ? m.bg_2h_at
                    : m.glucose_2h != null ? m.glucose_2h_at
                    : null;
  const delta1   = bgBefore != null && bg1h    != null ? bg1h    - bgBefore : null;
  const delta2   = bgBefore != null && bg2hRaw != null ? bg2hRaw - bgBefore : null;
  const speed1   = delta1 != null ? delta1 / 60  : null;
  const speed2   = delta2 != null ? delta2 / 120 : null;

  const gap1h = bg1h != null ? gapFromExpected(bg1h_at_str, mealMs, ONE_HOUR) : null;
  const gap2h = bg2hRaw != null && has_bg2h ? gapFromExpected(bg2h_at_str, mealMs, TWO_HOURS) : null;
  const out1h = gap1h != null && Math.abs(gap1h) > WINDOW_TOLERANCE_MIN;
  const out2h = gap2h != null && Math.abs(gap2h) > WINDOW_TOLERANCE_MIN;

  // Pass the meal's own timestamp so the evaluator's ratio path can
  // consult the user's per-time ICR schedule (Matildav Phase B).
  const mealTimeForIcr = m.meal_time
    ? new Date(mealMs)
    : (m.created_at ? new Date(m.created_at) : null);

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
    mealTime: mealTimeForIcr,
    // Curve-derived aggregates (Task #187) — enables HYPO_DURING and
    // peak-based SPIKE detection inside `evaluateEntry`. Null on rows
    // that pre-date the +3h backfill job, in which case the evaluator
    // silently falls back to the bg_2h-delta path.
    minBg180:      m.min_bg_180,
    maxBg180:      m.max_bg_180,
    timeToPeakMin: m.time_to_peak_min,
    hadHypoWindow: m.had_hypo_window,
    // Pre-meal CGM trend (Task #205) — regression-derived from the 15 min
    // of samples before meal_time. Undefined when no CGM history was
    // passed in (all existing callers that omit preMealSamples stay on
    // the old path; no behaviour change for them).
    preTrend,
    // Alcohol influence window (Dual-Emission): trigger is on the influence
    // log, not on meal-linkage. Standalone influences (source_meal_id NULL)
    // also extend the hypo monitoring window.
    linkedAlcoholG: linkedAlcoholG ?? null,
  });

  // Curve-finality (Task #187): if the +3h backfill job has populated
  // the window aggregates, the row is final regardless of whether the
  // bg_2h capture-at sits inside the legacy ±30 min window — the curve
  // is ground truth. HYPO_DURING in particular MUST win even when bg_2h
  // happens to be back inside the target band.
  const hasCurve = m.had_hypo_window != null || m.max_bg_180 != null || m.min_bg_180 != null;
  if (hasCurve && bgBefore != null) {
    const after = bg2hRaw ?? bg1h ?? null;
    const ev = baseEval(after);
    return { state: "final", outcome: ev.outcome, messages: ev.messages, delta1, delta2, speed1, speed2, ageMinutes, outOfWindow: false };
  }

  if (bg2hRaw != null && bgBefore != null) {
    if (out2h) {
      return {
        state:    "provisional",
        outcome:  null,
        messages: [{ key: "engine_lc_outside_window", params: { gap: gapParam(gap2h!) } }],
        delta1, delta2, speed1, speed2, ageMinutes,
        outOfWindow: true,
      };
    }
    const ev = baseEval(bg2hRaw);
    return { state: "final", outcome: ev.outcome, messages: ev.messages, delta1, delta2, speed1, speed2, ageMinutes, outOfWindow: false };
  }

  if (bg1h != null && bgBefore != null) {
    if (out1h) {
      return {
        state:    "provisional",
        outcome:  null,
        messages: [{ key: "engine_lc_outside_window", params: { gap: gapParam(gap1h!) } }],
        delta1, delta2, speed1, speed2, ageMinutes,
        outOfWindow: true,
      };
    }
    const ev = baseEval(bg1h);
    const isEarly = ageMinutes < ONE_HOUR;
    const windowMsg: AdjustmentMessage = isEarly
      ? { key: "engine_lc_window_early", params: { min: Math.round(ageMinutes) } }
      : { key: "engine_lc_window_1h" };
    const prefix: AdjustmentMessage = {
      key: "engine_lc_provisional_1h_prefix",
      params: { window: windowMsg.key, delta: `${delta1! > 0 ? "+" : ""}${delta1}` },
    };
    // Window key is referenced from prefix.params.window for consumers that
    // want to render it inline; also push the window key as its own message
    // so it can be looked up. Keep prefix first, then evaluation messages.
    return {
      state: "provisional",
      outcome: ev.outcome,
      messages: [prefix, ...ev.messages],
      delta1, delta2, speed1, speed2, ageMinutes,
      outOfWindow: false,
    };
  }

  if (ageMinutes < ONE_HOUR) {
    return {
      state: "pending",
      outcome: null,
      messages: [{ key: "engine_lc_awaiting_1h" }],
      delta1, delta2, speed1, speed2, ageMinutes,
      outOfWindow: false,
    };
  }

  const ev = baseEval(null);
  const note: AdjustmentMessage = ageMinutes >= TWO_HOURS
    ? { key: "engine_lc_no_post_meal" }
    : { key: "engine_lc_updates_after_2h" };
  return {
    state: "provisional",
    outcome: ev.outcome,
    messages: [...ev.messages, note],
    delta1, delta2, speed1, speed2, ageMinutes,
    outOfWindow: false,
  };
}
