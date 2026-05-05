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

/**
 * Localizable message descriptor for the suggestion / advisory text.
 *
 * `key` is a next-intl key under the `insights` namespace; `params` carries
 * the interpolation values that the consumer feeds into `t(key, params)`.
 *
 * The structured shape lets the UI render the text in the active locale
 * instead of a hard-coded English string, while keeping `lib/engine` free of
 * any UI/i18n imports.
 */
export interface AdjustmentMessage {
  key: string;
  params?: Record<string, string | number>;
}

export interface AdjustmentSuggestion {
  hasSuggestion: boolean;
  field?: "icr" | "correctionFactor" | "both";
  fromIcr?: number; toIcr?: number;
  fromCf?:  number; toCf?:  number;
  /** Localizable message descriptor — render with `t(message.key, message.params)`. */
  message: AdjustmentMessage;
  /**
   * Optional curve-derived advisories (Task #187 / #194). Populated when
   * `pattern.curveInsights` is present and one of the thresholds fires
   * (hypoRate > 0.2, fastSpikeRate > 0.4, lateDipRate > 0.2).
   *
   * Independent of `hasSuggestion`: a "balanced" pattern can still emit
   * an advisory like "20 % of meals showed a delayed dip 1–3h after"
   * even when there is no ICR/CF tweak to propose.
   */
  advisories?: AdjustmentMessage[];
  pattern: Pattern;
}

const STEP = 0.05; // ±5%

/**
 * Build the curve-derived advisory list from a pattern's `curveInsights`.
 * Returns `undefined` when the pattern has no curve data, so the caller
 * can leave the field off the response entirely instead of attaching an
 * empty array.
 *
 * Thresholds (per Task #237 / report findings):
 *   • hypoRate      > 0.20  → engine_msg_hypo_warning
 *   • fastSpikeRate > 0.40 + avgTimeToPeak known → engine_msg_fast_spike_hint
 *   • lateDipRate   > 0.20  → engine_msg_late_dip_warning
 *
 * Each advisory carries an integer % rounded for legibility — the same
 * convention the existing `engine_msg_overdosing` uses for ICR/CF deltas.
 */
function buildAdvisories(pattern: Pattern): AdjustmentMessage[] | undefined {
  const ci = pattern.curveInsights;
  if (!ci) return undefined;
  const out: AdjustmentMessage[] = [];

  if (ci.hypoRate > 0.2) {
    out.push({
      key: "engine_msg_hypo_warning",
      params: { rate: Math.round(ci.hypoRate * 100) },
    });
  }
  if (ci.fastSpikeRate > 0.4 && ci.avgTimeToPeak != null) {
    out.push({
      key: "engine_msg_fast_spike_hint",
      params: { avgMinutes: Math.round(ci.avgTimeToPeak) },
    });
  }
  if (ci.lateDipRate > 0.2) {
    out.push({
      key: "engine_msg_late_dip_warning",
      params: { rate: Math.round(ci.lateDipRate * 100) },
    });
  }
  return out.length > 0 ? out : undefined;
}

export function suggestAdjustment(current: AdaptiveSettings, pattern: Pattern): AdjustmentSuggestion {
  const advisories = buildAdvisories(pattern);

  if (pattern.type === "balanced" || pattern.type === "insufficient_data") {
    return { hasSuggestion: false, message: { key: "engine_msg_no_adjustment_needed" }, advisories, pattern };
  }
  if (pattern.confidence === "low" || pattern.sampleSize < 5) {
    return { hasSuggestion: false, message: { key: "engine_msg_low_confidence" }, advisories, pattern };
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
      message: {
        key: "engine_msg_overdosing",
        params: { fromIcr: current.icr, toIcr, fromCf: current.correctionFactor, toCf },
      },
      advisories,
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
      message: {
        key: "engine_msg_underdosing",
        params: { fromIcr: current.icr, toIcr, fromCf: current.correctionFactor, toCf },
      },
      advisories,
      pattern,
    };
  }

  if (pattern.type === "spiking") {
    return {
      hasSuggestion: false,
      message: { key: "engine_msg_spiking" },
      advisories,
      pattern,
    };
  }

  return { hasSuggestion: false, message: { key: "engine_msg_no_adjustment" }, advisories, pattern };
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
