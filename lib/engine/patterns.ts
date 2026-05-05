import type { Meal } from "@/lib/meals";
import { lifecycleFor } from "./lifecycle";

export type PatternType = "overdosing" | "underdosing" | "spiking" | "balanced" | "insufficient_data";

/**
 * Curve-aware insights computed from the dense 0–180 min CGM samples
 * (Task #187 / #194). Populated when at least one meal in the window
 * has a resolved curve (`max_bg_180 != null`); else `undefined`.
 *
 * These ride alongside the legacy outcome counts — they don't change
 * the `type` decision, they enrich the suggestion layer with extra
 * advisories (e.g. "20% of meals showed a delayed hypo between
 * 1–3h post-meal").
 */
export interface CurveInsights {
  /** Share of meals with a sub-70 mg/dL reading anywhere in the 3h window. */
  hypoRate: number;
  /** Share of meals whose glucose peak landed before +45 min. */
  fastSpikeRate: number;
  /** Share of meals with a delayed dip — min between +60 and +180 min was < 80 mg/dL. */
  lateDipRate: number;
  /** Mean minutes from meal-time to glucose peak across resolved meals. */
  avgTimeToPeak: number | null;
  /** Mean AUC over the 0–180 min window (mg/dL · min). */
  avgAuc: number | null;
}

export interface Pattern {
  type: PatternType;
  label: string;
  explanation: string;
  confidence: "low" | "medium" | "high";
  sampleSize: number;
  counts: { good: number; underdose: number; overdose: number; spike: number };
  /** Number of meals in the window that already have resolved curve aggregates. */
  curveDataAvailable?: number;
  /** Optional curve-derived advisories — only present when ≥1 meal had a resolved curve. */
  curveInsights?: CurveInsights;
}

const WINDOW = 20;
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

export function detectPattern(meals: Meal[], now: Date = new Date()): Pattern {
  const cutoffMs = now.getTime() - WINDOW_MS;

  const finals = meals
    .map(m => ({
      m,
      lc: lifecycleFor(m),
      t: Date.parse(m.meal_time ?? m.created_at ?? ""),
    }))
    .filter(x => x.lc.state === "final" && x.lc.outcome && isFinite(x.t) && x.t >= cutoffMs)
    .slice(0, WINDOW);

  const counts = { good: 0, underdose: 0, overdose: 0, spike: 0 };
  const weighted = { good: 0, underdose: 0, overdose: 0, spike: 0 };
  let weightSum = 0;

  for (const x of finals) {
    const ageMs = Math.max(0, now.getTime() - x.t);
    const ageRatio = Math.min(1, ageMs / WINDOW_MS);
    const w = 1 - 0.5 * ageRatio;
    weightSum += w;

    if (x.lc.outcome === "GOOD")           { counts.good++;      weighted.good      += w; }
    else if (x.lc.outcome === "UNDERDOSE") { counts.underdose++; weighted.underdose += w; }
    else if (x.lc.outcome === "OVERDOSE")  { counts.overdose++;  weighted.overdose  += w; }
    else if (x.lc.outcome === "SPIKE")     { counts.spike++;     weighted.spike     += w; }
  }

  // ── Curve-aware enrichment (Task #187 / #194) ──────────────────────
  // Computed across the same window as the outcome counts so the
  // share-based metrics (hypoRate, fastSpikeRate, lateDipRate) line
  // up with the legacy `counts.*` numbers. Only meals whose +3h
  // backfill job has resolved (`max_bg_180 != null`) contribute —
  // older rows without curve aggregates are silently skipped, so
  // `curveInsights` becomes available smoothly as more meals
  // accumulate post-rollout instead of all-or-nothing.
  const withCurve = finals.filter(x => x.m.max_bg_180 != null);
  const curveDataAvailable = withCurve.length;

  let curveInsights: CurveInsights | undefined;
  if (curveDataAvailable > 0) {
    const denom = curveDataAvailable;
    const hypoCount = withCurve.filter(x => x.m.had_hypo_window === true).length;
    const fastSpikeCount = withCurve.filter(x =>
      x.m.time_to_peak_min != null && x.m.time_to_peak_min < 45,
    ).length;
    const lateDipCount = withCurve.filter(x =>
      x.m.min_bg_60_180 != null && x.m.min_bg_60_180 < 80,
    ).length;

    const peakTimes = withCurve
      .map(x => x.m.time_to_peak_min)
      .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
    const aucs = withCurve
      .map(x => x.m.auc_180)
      .filter((a): a is number => typeof a === "number" && Number.isFinite(a));

    curveInsights = {
      hypoRate: hypoCount / denom,
      fastSpikeRate: fastSpikeCount / denom,
      lateDipRate: lateDipCount / denom,
      avgTimeToPeak: peakTimes.length
        ? peakTimes.reduce((a, b) => a + b, 0) / peakTimes.length
        : null,
      avgAuc: aucs.length
        ? aucs.reduce((a, b) => a + b, 0) / aucs.length
        : null,
    };
  }

  const n = finals.length;
  if (n < 5) {
    return {
      type: "insufficient_data",
      label: "Not enough data",
      explanation: `Need at least 5 meals with a post-meal reading in the last ${WINDOW_DAYS} days to detect a pattern (currently ${n}).`,
      confidence: "low",
      sampleSize: n,
      counts,
      curveDataAvailable,
      curveInsights,
    };
  }

  const overdoseRate  = weighted.overdose  / weightSum;
  const underdoseRate = weighted.underdose / weightSum;
  const spikeRate     = weighted.spike     / weightSum;
  const goodRate      = weighted.good      / weightSum;

  const confidence: Pattern["confidence"] = n >= 15 ? "high" : n >= 10 ? "medium" : "low";

  if (overdoseRate > 0.5) {
    return {
      type: "overdosing",
      label: "Frequent over-dosing",
      explanation: `${Math.round(overdoseRate * 100)}% of your last ${n} meals ended below target — insulin is consistently too strong for your meals.`,
      confidence, sampleSize: n, counts, curveDataAvailable, curveInsights,
    };
  }
  if (underdoseRate > 0.5) {
    return {
      type: "underdosing",
      label: "Consistent under-dosing",
      explanation: `${Math.round(underdoseRate * 100)}% of your last ${n} meals ended high — insulin is consistently too weak for your carb load.`,
      confidence, sampleSize: n, counts, curveDataAvailable, curveInsights,
    };
  }
  if (spikeRate > 0.4) {
    return {
      type: "spiking",
      label: "Frequent post-meal spikes",
      explanation: `${Math.round(spikeRate * 100)}% of recent meals showed a rapid rise. Consider pre-bolusing or rebalancing fast carbs.`,
      confidence, sampleSize: n, counts, curveDataAvailable, curveInsights,
    };
  }
  return {
    type: "balanced",
    label: "Balanced dosing",
    explanation: `${Math.round(goodRate * 100)}% of your last ${n} meals landed in target — keep it up.`,
    confidence, sampleSize: n, counts, curveDataAvailable, curveInsights,
  };
}
