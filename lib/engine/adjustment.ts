import type { Pattern } from "./patterns";

export interface AdaptiveSettings {
  icr: number;             // grams of carb per 1u
  correctionFactor: number;// mg/dL drop per 1u
  lastUpdated: string | null;
  adjustmentHistory: AdjustmentRecord[];
}

export interface AdjustmentRecord {
  at: string;
  field: "icr" | "correctionFactor";
  from: number;
  to: number;
  reason: string;
}

export interface AdjustmentSuggestion {
  hasSuggestion: boolean;
  field?: "icr" | "correctionFactor" | "both";
  fromIcr?: number; toIcr?: number;
  fromCf?:  number; toCf?:  number;
  message: string;
  pattern: Pattern;
}

const STEP = 0.05; // ±5%

export function suggestAdjustment(current: AdaptiveSettings, pattern: Pattern): AdjustmentSuggestion {
  if (pattern.type === "balanced" || pattern.type === "insufficient_data") {
    return { hasSuggestion: false, message: "No adjustment needed.", pattern };
  }
  if (pattern.confidence === "low" || pattern.sampleSize < 5) {
    return { hasSuggestion: false, message: "Pattern detected but confidence is too low to suggest changes.", pattern };
  }

  if (pattern.type === "overdosing") {
    // Insulin too strong → carbs per unit goes UP (less insulin per carb).
    const toIcr = round1(current.icr * (1 + STEP));
    const toCf  = round1(current.correctionFactor * (1 + STEP));
    return {
      hasSuggestion: true,
      field: "both",
      fromIcr: current.icr, toIcr,
      fromCf:  current.correctionFactor, toCf,
      message: `Based on recent meals, your carb ratio could move from 1:${current.icr} → 1:${toIcr} and your correction factor from ${current.correctionFactor} → ${toCf} (gentler dosing).`,
      pattern,
    };
  }

  if (pattern.type === "underdosing") {
    // Insulin too weak → carbs per unit goes DOWN (more insulin per carb).
    const toIcr = round1(current.icr * (1 - STEP));
    const toCf  = round1(current.correctionFactor * (1 - STEP));
    return {
      hasSuggestion: true,
      field: "both",
      fromIcr: current.icr, toIcr,
      fromCf:  current.correctionFactor, toCf,
      message: `Based on recent meals, your carb ratio could move from 1:${current.icr} → 1:${toIcr} and your correction factor from ${current.correctionFactor} → ${toCf} (stronger dosing).`,
      pattern,
    };
  }

  if (pattern.type === "spiking") {
    return {
      hasSuggestion: false,
      message: "Spike pattern detected — consider pre-bolusing 10–15 min earlier rather than changing your ratios.",
      pattern,
    };
  }

  return { hasSuggestion: false, message: "No adjustment.", pattern };
}

export function applyAdjustment(s: AdaptiveSettings, sug: AdjustmentSuggestion): AdaptiveSettings {
  if (!sug.hasSuggestion) return s;
  const at = new Date().toISOString();
  const next: AdaptiveSettings = { ...s, adjustmentHistory: [...s.adjustmentHistory] };
  if (sug.toIcr != null && sug.toIcr !== s.icr) {
    next.adjustmentHistory.push({ at, field: "icr", from: s.icr, to: sug.toIcr, reason: sug.pattern.label });
    next.icr = sug.toIcr;
  }
  if (sug.toCf != null && sug.toCf !== s.correctionFactor) {
    next.adjustmentHistory.push({ at, field: "correctionFactor", from: s.correctionFactor, to: sug.toCf, reason: sug.pattern.label });
    next.correctionFactor = sug.toCf;
  }
  next.lastUpdated = at;
  return next;
}

function round1(n: number) { return Math.round(n * 10) / 10; }
