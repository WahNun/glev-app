import type { ExerciseLog, ExerciseType } from "./exercise";

export type ExerciseOutcome =
  | "STABLE"
  | "DROPPED"
  | "SPIKED"
  | "HYPO_RISK"
  | "PENDING";

/** How long after a fetch_time the CGM job process route gives up. Mirrors
 *  EXERCISE_ABANDON_AFTER_MS in app/api/cgm-jobs/process/route.ts. Used by
 *  the per-reading "No data" UI label inside the Glucose tracking panel
 *  (the badge itself stays in the spec's 5-state set even past this
 *  cutoff — overdue rows continue to read PENDING). */
export const EXERCISE_NO_DATA_AFTER_MS = 3 * 60 * 60 * 1000;

export interface ExerciseOutcomeInfo {
  outcome: ExerciseOutcome;
  /** Short label for the row badge. */
  label: string;
  /** Hex / rgba colour token used for the badge + delta highlights. */
  color: string;
}

const COLORS: Record<ExerciseOutcome, string> = {
  STABLE:    "#22C55E",
  DROPPED:   "#F59E0B",
  SPIKED:    "#F97316",
  HYPO_RISK: "#EF4444",
  PENDING:   "rgba(255,255,255,0.45)",
};

const LABELS: Record<ExerciseOutcome, string> = {
  STABLE:    "STABLE",
  DROPPED:   "DROPPED",
  SPIKED:    "SPIKED",
  HYPO_RISK: "HYPO RISK",
  PENDING:   "PENDING",
};

/** Hypoglycaemia threshold (mg/dL) — anything below counts as hypo risk. */
export const HYPO_THRESHOLD = 70;

/**
 * Classify the workout's glucose response. Pure function — all inputs
 * already live on the log row (CGM jobs fill them in over time).
 *
 * Thresholds (vs `cgm_glucose_at_log`, evaluated at workout end):
 *   - any reading < 70 mg/dL  → HYPO_RISK
 *   - drop ≥ 30 % from before → DROPPED
 *   - rise ≥ 20 % from before → SPIKED
 *   - otherwise               → STABLE
 *   - at_end still missing    → PENDING
 */
export function evaluateExercise(log: ExerciseLog): ExerciseOutcomeInfo {
  const before  = numOrNull(log.cgm_glucose_at_log);
  const atEnd   = numOrNull(log.glucose_at_end);
  const after1h = numOrNull(log.glucose_after_1h);

  // Spec rule: PENDING precedence — until the at-end reading exists,
  // the badge stays PENDING regardless of the +1h value. (A late +1h
  // hypo without an at-end value is degenerate and should not flip
  // the badge from PENDING.) The badge stays PENDING even past the
  // 3 h CGM job cutoff — the spec lists exactly 5 outcomes. The
  // overdue "No data" hint is surfaced inside the Glucose tracking
  // panel via pendingLabel(), not on the badge.
  if (atEnd == null) return mk("PENDING");

  // Hypo risk wins over delta-based outcomes once at-end exists.
  if (atEnd < HYPO_THRESHOLD ||
      (after1h != null && after1h < HYPO_THRESHOLD)) {
    return mk("HYPO_RISK");
  }

  if (before != null && before > 0) {
    const delta = (atEnd - before) / before;
    if (delta <= -0.30) return mk("DROPPED");
    if (delta >=  0.20) return mk("SPIKED");
    return mk("STABLE");
  }

  // No "before" baseline — can't compute a delta, but at_end is in
  // range, so call it stable.
  return mk("STABLE");
}

function mk(o: ExerciseOutcome): ExerciseOutcomeInfo {
  return { outcome: o, label: LABELS[o], color: COLORS[o] };
}

function numOrNull(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Colour code a glucose delta (mg/dL). Used for the tracking panel. */
export function deltaColor(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return "rgba(255,255,255,0.4)";
  if (delta <= -50) return COLORS.DROPPED;
  if (delta >=  40) return COLORS.SPIKED;
  return COLORS.STABLE;
}

/**
 * Free-text helper used by the "interim" evaluation block, shown once
 * the at-end reading lands. Reads as a neutral observation, never as
 * a recommendation.
 */
export function interimMessage(log: ExerciseLog): string | null {
  const before = numOrNull(log.cgm_glucose_at_log);
  const atEnd  = numOrNull(log.glucose_at_end);
  if (atEnd == null) return null;
  if (atEnd < HYPO_THRESHOLD) {
    return `Glucose ended low (${Math.round(atEnd)} mg/dL). Watch the next hour closely — delayed hypos are common after exercise.`;
  }
  if (before == null) {
    return `Workout ended at ${Math.round(atEnd)} mg/dL. No baseline glucose was captured at start.`;
  }
  const diff = atEnd - before;
  const pct  = before > 0 ? (diff / before) * 100 : 0;
  const dirWord = diff > 0 ? "rose" : diff < 0 ? "fell" : "held";
  const absDiff = Math.abs(Math.round(diff));
  const absPct  = Math.abs(Math.round(pct));
  if (Math.abs(pct) <= 15) {
    return `Glucose held steady — moved ${absDiff} mg/dL (${absPct}%) from start to end.`;
  }
  return `Glucose ${dirWord} ${absDiff} mg/dL (${absPct}%) from start (${Math.round(before)}) to end (${Math.round(atEnd)}).`;
}

/**
 * Final 1-hour evaluation message, shown once the +1h reading lands.
 */
export function finalMessage(log: ExerciseLog): string | null {
  const atEnd   = numOrNull(log.glucose_at_end);
  const after1h = numOrNull(log.glucose_after_1h);
  if (after1h == null) return null;
  if (after1h < HYPO_THRESHOLD) {
    return `1 h after the workout, glucose dropped to ${Math.round(after1h)} mg/dL — that's the delayed-hypo window playing out.`;
  }
  if (atEnd == null) {
    return `1 h after the workout, glucose was ${Math.round(after1h)} mg/dL.`;
  }
  const diff = after1h - atEnd;
  const dirWord = diff > 0 ? "kept rising" : diff < 0 ? "kept falling" : "held";
  const absDiff = Math.abs(Math.round(diff));
  if (Math.abs(diff) <= 15) {
    return `Glucose stabilised in the hour after — ${Math.round(after1h)} mg/dL (Δ ${absDiff}).`;
  }
  return `In the hour after the workout, glucose ${dirWord} (${Math.round(atEnd)} → ${Math.round(after1h)} mg/dL, Δ ${absDiff}).`;
}

/**
 * Static educational note keyed off the exercise type. Pure prose,
 * never personalised, never prescriptive.
 */
export function patternNote(t: ExerciseType): string {
  switch (t) {
    case "cardio":
    case "cycling":
    case "run":
      return "Aerobic exercise typically lowers glucose, with a delayed-hypo window 30–90 min after the session.";
    case "hiit":
      return "High-intensity intervals can push glucose UP during the workout (stress response) and then down sharply afterwards.";
    case "strength":
    case "hypertrophy":
      return "Resistance training often nudges glucose UP transiently; values commonly settle within 1–2 h.";
    case "yoga":
      return "Yoga and low-intensity movement usually have a mild, stabilising effect on glucose.";
  }
}

/** Display label for an exercise type. Maps legacy 'hypertrophy' → 'Strength'. */
export function exerciseTypeLabel(t: ExerciseType): string {
  switch (t) {
    case "hypertrophy":
    case "strength":  return "Strength";
    case "cardio":    return "Cardio";
    case "hiit":      return "HIIT";
    case "yoga":      return "Yoga";
    case "cycling":   return "Cycling";
    case "run":       return "Run";
  }
}
