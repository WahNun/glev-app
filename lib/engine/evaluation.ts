export type Outcome = "GOOD" | "UNDERDOSE" | "OVERDOSE" | "SPIKE" | "CHECK_CONTEXT";

export type Classification = "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED" | null | undefined;

export interface EvaluateEntryInput {
  carbs: number;
  protein?: number;
  fat?: number;
  fiber?: number;
  insulin: number;
  bgBefore: number | null;
  bgAfter?: number | null;
  classification?: Classification;
}

export interface EvaluateEntryResult {
  outcome: Outcome;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  delta: number | null;
  netCarbs: number;
}

/**
 * Deterministic post-hoc evaluation.
 *
 * Uses the glucose delta (bgAfter - bgBefore) as the ground truth for
 * the outcome — NOT GPT, NOT any heuristic dose ratio. If bgAfter is
 * missing we fall back to a conservative ICR-ratio estimate so that
 * entries without a post-meal reading still get a label.
 */
export function evaluateEntry(input: EvaluateEntryInput): EvaluateEntryResult {
  const carbs    = Math.max(0, input.carbs || 0);
  const fiber    = Math.max(0, input.fiber || 0);
  const netCarbs = Math.max(0, carbs - fiber);
  const insulin  = Math.max(0, input.insulin || 0);
  const bgBefore = input.bgBefore ?? null;
  const bgAfter  = input.bgAfter  ?? null;
  const cls      = input.classification || "BALANCED";

  const delta = bgBefore != null && bgAfter != null ? bgAfter - bgBefore : null;

  // Classification-aware spike thresholds.
  // FAST_CARBS absorb faster → a bigger rise is still normal.
  // HIGH_FAT   delays glucose → an early rise is more suspicious.
  const spikeCutoff =
    cls === "FAST_CARBS" ? 70 :
    cls === "HIGH_FAT"   ? 40 :
    cls === "HIGH_PROTEIN" ? 50 :
    55;

  if (delta != null) {
    let outcome: Outcome;
    let reasoning: string;
    if (delta > spikeCutoff) {
      outcome = "SPIKE";
      reasoning = `Post-meal glucose rose ${delta} mg/dL — rapid spike beyond the ${spikeCutoff} mg/dL threshold for ${labelFor(cls)}.`;
    } else if (delta > 30) {
      outcome = "UNDERDOSE";
      reasoning = `Post-meal glucose rose ${delta} mg/dL — insulin insufficient for the carb load.`;
    } else if (delta < -30) {
      outcome = "OVERDOSE";
      reasoning = `Post-meal glucose dropped ${Math.abs(delta)} mg/dL — insulin exceeded glucose needs.`;
    } else {
      outcome = "GOOD";
      reasoning = `Glucose stayed within ±30 mg/dL (Δ${delta > 0 ? "+" : ""}${delta}) — dose matched the meal.`;
    }
    const confidence: EvaluateEntryResult["confidence"] =
      Math.abs(delta) > 80 ? "high" : Math.abs(delta) > 25 ? "medium" : "high";
    return { outcome, reasoning, confidence, delta, netCarbs };
  }

  // No bgAfter: fallback ICR-ratio heuristic (lower confidence, marked CHECK_CONTEXT when ambiguous).
  const ICR = 15, CF = 50, TARGET = 110;
  let expected = netCarbs / ICR;
  if (bgBefore && bgBefore > TARGET) expected += (bgBefore - TARGET) / CF;
  const ratio = insulin / Math.max(expected, 0.1);

  let outcome: Outcome;
  let reasoning: string;
  if (ratio > 1.35) {
    outcome = "OVERDOSE";
    reasoning = `Dose is ${Math.round((ratio - 1) * 100)}% above the ICR-expected amount — likely over-dose (no post-meal reading).`;
  } else if (ratio < 0.65) {
    outcome = "UNDERDOSE";
    reasoning = `Dose is ${Math.round((1 - ratio) * 100)}% below the ICR-expected amount — likely under-dose (no post-meal reading).`;
  } else {
    outcome = "GOOD";
    reasoning = `Dose matches the ICR-expected amount within ±35% (no post-meal reading to confirm).`;
  }
  return { outcome, reasoning, confidence: "low", delta: null, netCarbs };
}

function labelFor(cls: Classification) {
  switch (cls) {
    case "FAST_CARBS":   return "fast-carb meals";
    case "HIGH_PROTEIN": return "high-protein meals";
    case "HIGH_FAT":     return "high-fat meals";
    default:             return "balanced meals";
  }
}
