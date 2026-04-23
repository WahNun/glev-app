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

export function detectPattern(meals: Meal[]): Pattern {
  const finals = meals
    .map(m => ({ m, lc: lifecycleFor(m) }))
    .filter(x => x.lc.state === "final" && x.lc.outcome)
    .slice(0, WINDOW);

  const counts = { good: 0, underdose: 0, overdose: 0, spike: 0 };
  for (const x of finals) {
    if (x.lc.outcome === "GOOD") counts.good++;
    else if (x.lc.outcome === "UNDERDOSE") counts.underdose++;
    else if (x.lc.outcome === "OVERDOSE") counts.overdose++;
    else if (x.lc.outcome === "SPIKE") counts.spike++;
  }

  const n = finals.length;
  if (n < 5) {
    return {
      type: "insufficient_data",
      label: "Not enough data",
      explanation: `Need at least 5 meals with a post-meal reading to detect a pattern (currently ${n}).`,
      confidence: "low",
      sampleSize: n,
      counts,
    };
  }

  const overdoseRate  = counts.overdose / n;
  const underdoseRate = counts.underdose / n;
  const spikeRate     = counts.spike / n;
  const goodRate      = counts.good / n;

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
