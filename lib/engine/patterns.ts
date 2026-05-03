import type { Meal } from "@/lib/meals";
import { lifecycleFor } from "./lifecycle";

export type PatternType = "overdosing" | "underdosing" | "spiking" | "balanced" | "insufficient_data";

export interface Pattern {
  type: PatternType;
  label: string;
  explanation: string;
  confidence: "low" | "medium" | "high";
  sampleSize: number;
  counts: { good: number; underdose: number; overdose: number; spike: number };
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

  const n = finals.length;
  if (n < 5) {
    return {
      type: "insufficient_data",
      label: "Not enough data",
      explanation: `Need at least 5 meals with a post-meal reading in the last ${WINDOW_DAYS} days to detect a pattern (currently ${n}).`,
      confidence: "low",
      sampleSize: n,
      counts,
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
      confidence, sampleSize: n, counts,
    };
  }
  if (underdoseRate > 0.5) {
    return {
      type: "underdosing",
      label: "Consistent under-dosing",
      explanation: `${Math.round(underdoseRate * 100)}% of your last ${n} meals ended high — insulin is consistently too weak for your carb load.`,
      confidence, sampleSize: n, counts,
    };
  }
  if (spikeRate > 0.4) {
    return {
      type: "spiking",
      label: "Frequent post-meal spikes",
      explanation: `${Math.round(spikeRate * 100)}% of recent meals showed a rapid rise. Consider pre-bolusing or rebalancing fast carbs.`,
      confidence, sampleSize: n, counts,
    };
  }
  return {
    type: "balanced",
    label: "Balanced dosing",
    explanation: `${Math.round(goodRate * 100)}% of your last ${n} meals landed in target — keep it up.`,
    confidence, sampleSize: n, counts,
  };
}
