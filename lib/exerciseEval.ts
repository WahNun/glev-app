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
  // Task #194: dense-curve hypo wins over PENDING and the legacy
  // point-value rules — a delayed hypo BETWEEN the at-end and +1h
  // slots would otherwise stay invisible. The `had_hypo_window`
  // flag is set by the +3h exercise_curve_180 job from the full
  // 0–180 min post-workout CGM time series.
  if (log.had_hypo_window === true) return mk("HYPO_RISK");

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
export function interimMessage(log: ExerciseLog, locale = "de"): string | null {
  const before = numOrNull(log.cgm_glucose_at_log);
  const atEnd  = numOrNull(log.glucose_at_end);
  if (atEnd == null) return null;
  const de = locale === "de";
  if (atEnd < HYPO_THRESHOLD) {
    return de
      ? `Glukose am Ende niedrig (${Math.round(atEnd)} mg/dL). Die nächste Stunde aufmerksam beobachten — verzögerte Hypos nach dem Training sind häufig.`
      : `Glucose ended low (${Math.round(atEnd)} mg/dL). Watch the next hour closely — delayed hypos are common after exercise.`;
  }
  if (before == null) {
    return de
      ? `Training endete bei ${Math.round(atEnd)} mg/dL. Kein Ausgangswert zu Trainingsbeginn erfasst.`
      : `Workout ended at ${Math.round(atEnd)} mg/dL. No baseline glucose was captured at start.`;
  }
  const diff = atEnd - before;
  const pct  = before > 0 ? (diff / before) * 100 : 0;
  const absDiff = Math.abs(Math.round(diff));
  const absPct  = Math.abs(Math.round(pct));
  if (Math.abs(pct) <= 15) {
    return de
      ? `Glukose blieb stabil — Bewegung von ${absDiff} mg/dL (${absPct}%) von Start bis Ende.`
      : `Glucose held steady — moved ${absDiff} mg/dL (${absPct}%) from start to end.`;
  }
  if (de) {
    const dirWordDE = diff > 0 ? "stieg um" : "fiel um";
    return `Glukose ${dirWordDE} ${absDiff} mg/dL (${absPct}%) von Start (${Math.round(before)}) bis Ende (${Math.round(atEnd)}).`;
  }
  const dirWord = diff > 0 ? "rose" : diff < 0 ? "fell" : "held";
  return `Glucose ${dirWord} ${absDiff} mg/dL (${absPct}%) from start (${Math.round(before)}) to end (${Math.round(atEnd)}).`;
}

/**
 * Final 1-hour evaluation message, shown once the +1h reading lands.
 */
export function finalMessage(log: ExerciseLog, locale = "de"): string | null {
  const atEnd   = numOrNull(log.glucose_at_end);
  const after1h = numOrNull(log.glucose_after_1h);
  if (after1h == null) return null;
  const de = locale === "de";
  if (after1h < HYPO_THRESHOLD) {
    return de
      ? `1 h nach dem Training fiel die Glukose auf ${Math.round(after1h)} mg/dL — das verzögerte Hypo-Fenster tritt ein.`
      : `1 h after the workout, glucose dropped to ${Math.round(after1h)} mg/dL — that's the delayed-hypo window playing out.`;
  }
  if (atEnd == null) {
    return de
      ? `1 h nach dem Training lag die Glukose bei ${Math.round(after1h)} mg/dL.`
      : `1 h after the workout, glucose was ${Math.round(after1h)} mg/dL.`;
  }
  const diff = after1h - atEnd;
  const absDiff = Math.abs(Math.round(diff));
  if (Math.abs(diff) <= 15) {
    return de
      ? `Glukose stabilisierte sich in der Stunde danach — ${Math.round(after1h)} mg/dL (Δ ${absDiff}).`
      : `Glucose stabilised in the hour after — ${Math.round(after1h)} mg/dL (Δ ${absDiff}).`;
  }
  if (de) {
    const dirWordDE = diff > 0 ? "stieg weiter" : "fiel weiter";
    return `In der Stunde nach dem Training ${dirWordDE} die Glukose (${Math.round(atEnd)} → ${Math.round(after1h)} mg/dL, Δ ${absDiff}).`;
  }
  const dirWord = diff > 0 ? "kept rising" : diff < 0 ? "kept falling" : "held";
  return `In the hour after the workout, glucose ${dirWord} (${Math.round(atEnd)} → ${Math.round(after1h)} mg/dL, Δ ${absDiff}).`;
}

/**
 * Static educational note keyed off the exercise type. Pure prose,
 * never personalised, never prescriptive.
 */
export function patternNote(t: ExerciseType, locale = "de"): string {
  const de = locale === "de";
  switch (t) {
    case "cardio":
    case "cycling":
    case "run":
    case "swimming":
    // Team / racquet sports are intermittent aerobic activity — same
    // delayed-hypo profile as steady cardio for pattern-note purposes.
    case "football":
    case "tennis":
    case "volleyball":
    case "basketball":
      return de
        ? "Aerobe Belastung senkt typischerweise den Glukosespiegel, mit einem verzögerten Hypo-Fenster 30–90 Minuten nach der Einheit."
        : "Aerobic exercise typically lowers glucose, with a delayed-hypo window 30–90 min after the session.";
    case "hiit":
      return de
        ? "Hochintensive Intervalle können den Glukosespiegel während des Trainings anheben (Stressreaktion) und danach stark abfallen lassen."
        : "High-intensity intervals can push glucose UP during the workout (stress response) and then down sharply afterwards.";
    case "strength":
    case "hypertrophy":
      return de
        ? "Krafttraining hebt den Glukosespiegel vorübergehend oft leicht an; die Werte normalisieren sich meist innerhalb von 1–2 Stunden."
        : "Resistance training often nudges glucose UP transiently; values commonly settle within 1–2 h.";
    case "yoga":
      return de
        ? "Yoga und sanfte Bewegung haben meist einen milden, stabilisierenden Effekt auf den Glukosespiegel."
        : "Yoga and low-intensity movement usually have a mild, stabilising effect on glucose.";
    case "breathwork":
      return de
        ? "Atemübungen können den Glukosespiegel in beide Richtungen verschieben — adrenerge Stile (Wim Hof, schnelles holotropes Atmen) heben ihn über Stresshormone oft an, während langsames Box-Atmen / parasympathische Atmung ihn eher stabilisiert."
        : "Breathwork sessions can shift glucose in either direction — adrenergic styles (Wim Hof, fast holotropic) often nudge it UP via stress hormones, while slow box / parasympathetic breathing tends to settle it.";
    case "hot_shower":
      return de
        ? "Eine heiße Dusche bewirkt Vasodilatation, die die Insulinaufnahme beschleunigen kann — achte auf einen ungewöhnlich schnellen Glukoseabfall in den nächsten 30–60 Minuten."
        : "A hot shower causes vasodilation, which can speed up insulin absorption — watch for an unusually fast glucose drop in the next 30–60 min.";
    case "cold_shower":
      return de
        ? "Eine kalte Dusche löst Vasokonstriktion und eine kurze Adrenalinausschüttung aus, die den Glukosespiegel vorübergehend anheben kann."
        : "A cold shower triggers vasoconstriction and a brief adrenaline response, which can transiently push glucose UP.";
  }
}

/** Display label for an exercise type. Maps legacy 'hypertrophy' → 'Strength'.
 *
 *  English-only — kept for non-UI / fallback contexts (e.g. building
 *  the headline sentence in `personalPatternHeadline()` which is
 *  itself an English template). UI surfaces should prefer
 *  `exerciseTypeLabelI18n(t, type)` so labels follow the active
 *  locale (German users see "Krafttraining" / "Fußball" instead of
 *  "Strength" / "Football"). */
export function exerciseTypeLabel(t: ExerciseType): string {
  switch (t) {
    case "hypertrophy":
    case "strength":  return "Strength";
    case "cardio":    return "Cardio";
    case "hiit":      return "HIIT";
    case "yoga":      return "Yoga";
    case "cycling":   return "Cycling";
    case "run":       return "Run";
    case "football":  return "Football";
    case "tennis":    return "Tennis";
    case "volleyball":return "Volleyball";
    case "basketball":return "Basketball";
    case "swimming":  return "Swimming";
    case "breathwork":  return "Breathwork";
    case "hot_shower":  return "Hot shower";
    case "cold_shower": return "Cold shower";
  }
}

/**
 * Short glyph shown inside the monogram circle on the dashboard's
 * recent-entries row. Team sports get an emoji so the list is
 * scannable at a glance; other types keep a single Latin letter so
 * the circle stays visually calm.
 *
 *   ⚽ football   🎾 tennis   🏐 volleyball   🏀 basketball
 *   C  cycling    S  swimming
 *   E  everything else (cardio, hiit, run, strength, yoga, …)
 */
export function exerciseTypeGlyph(type: ExerciseType): string {
  switch (type) {
    case "football":   return "⚽";
    case "tennis":     return "🎾";
    case "volleyball": return "🏐";
    case "basketball": return "🏀";
    case "cycling":    return "C";
    case "swimming":   return "S";
    default:           return "E";
  }
}

/** Locale-aware version of `exerciseTypeLabel`. Pass a translator
 *  bound to the `insights` namespace (e.g. `useTranslations("insights")`)
 *  — that's where the `exercise_type_*` keys live in
 *  messages/{de,en}.json. The legacy `hypertrophy` token is collapsed
 *  to `strength` so old rows still resolve to a real translation key. */
export function exerciseTypeLabelI18n(
  t: (key: string) => string,
  type: ExerciseType,
): string {
  const norm = type === "hypertrophy" ? "strength" : type;
  return t(`exercise_type_${norm}`);
}

/**
 * Returns the `insights` namespace key for the static educational
 * pattern note of a given exercise type. Multiple aerobic types share
 * the same key ("cardio"); strength + legacy hypertrophy collapse to
 * "strength". Pass the result to a translator bound to the `insights`
 * namespace (e.g. `tIns(exercisePatternNoteKey(type))`).
 */
export function exercisePatternNoteKey(type: ExerciseType): string {
  switch (type) {
    case "cardio":
    case "cycling":
    case "run":
    case "swimming":
    case "football":
    case "tennis":
    case "volleyball":
    case "basketball":
      return "exercise_pattern_note_cardio";
    case "hiit":
      return "exercise_pattern_note_hiit";
    case "strength":
    case "hypertrophy":
      return "exercise_pattern_note_strength";
    case "yoga":
      return "exercise_pattern_note_yoga";
    case "breathwork":
      return "exercise_pattern_note_breathwork";
    case "hot_shower":
      return "exercise_pattern_note_hot_shower";
    case "cold_shower":
      return "exercise_pattern_note_cold_shower";
  }
}

// ────────────────────────────────────────────────────────────────────
// Cross-entry aggregation: per-exercise-type personal pattern stats.
//
// Turns the per-row outcome from `evaluateExercise()` into THIS user's
// historical baseline — "your runs usually drop glucose ~40". Pure,
// stateless, and computed client-side from already-fetched
// `exercise_logs` rows so no schema change or new fetch is required.
//
// Conventions:
//   - The `hypertrophy` legacy type is collapsed into `strength`
//     before grouping so the rename in `lib/exercise.ts` doesn't
//     split a user's history into two adjacent buckets.
//   - "Δ before → at-end" / "Δ before → +1 h" require BOTH endpoints
//     to be present on the row; rows missing either are skipped for
//     the corresponding median (but still counted in `count`).
//   - Hypo-risk share counts only sessions where the at-end reading
//     has landed (so PENDING rows never inflate either numerator or
//     denominator). This mirrors `evaluateExercise()`'s precedence
//     rule that PENDING wins until at-end exists.
// ────────────────────────────────────────────────────────────────────

/** Median of a non-empty numeric array. Returns null for empty input
 *  so callers can short-circuit without a divide-by-zero guard. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Normalise the legacy `hypertrophy` alias to `strength` so grouping
 *  stays stable across the type rename in `lib/exercise.ts`. */
export function normalizeExerciseType(t: ExerciseType): ExerciseType {
  return t === "hypertrophy" ? "strength" : t;
}

export interface ExerciseTypeStats {
  /** Canonical (post-normalisation) exercise type key. */
  type: ExerciseType;
  /** Total sessions of this type in the input window. */
  count: number;
  /** Sessions with a Δ before → at-end value available. */
  atEndSampleSize: number;
  /** Sessions with a Δ before → +1 h value available. */
  oneHourSampleSize: number;
  /** Median Δ (mg/dL) from baseline → workout-end reading, rounded. */
  medianDeltaAtEnd: number | null;
  /** Median Δ (mg/dL) from baseline → +1 h reading, rounded. */
  medianDelta1h: number | null;
  /** Sessions classified by `evaluateExercise()` (i.e. at-end has
   *  landed). PENDING rows are excluded so the share is meaningful. */
  classifiedCount: number;
  /** Sessions whose outcome was HYPO_RISK. */
  hypoRiskCount: number;
  /** hypoRiskCount / classifiedCount, in the [0, 1] range, or null
   *  when classifiedCount is 0. */
  hypoRiskShare: number | null;
}

/**
 * Aggregate every log of a single exercise type into a personal
 * pattern summary. `logs` is the full pool — this helper does its
 * own filter so callers don't need to pre-slice. Returns `null` only
 * when no row of that type exists in the pool (cheap signal for
 * "hide the card entirely").
 */
export function aggregateExerciseTypeStats(
  logs: ExerciseLog[],
  type: ExerciseType,
): ExerciseTypeStats | null {
  const target = normalizeExerciseType(type);
  const ofType = logs.filter(l => normalizeExerciseType(l.exercise_type) === target);
  if (ofType.length === 0) return null;

  const deltasAtEnd: number[] = [];
  const deltas1h: number[]    = [];
  let classifiedCount = 0;
  let hypoRiskCount   = 0;

  for (const log of ofType) {
    const before  = numOrNull(log.cgm_glucose_at_log);
    const atEnd   = numOrNull(log.glucose_at_end);
    const after1h = numOrNull(log.glucose_after_1h);

    if (before != null && atEnd   != null) deltasAtEnd.push(atEnd   - before);
    if (before != null && after1h != null) deltas1h.push(after1h - before);

    // Outcome-based stats — only count sessions that have actually
    // been classified (at-end reading exists OR the dense-curve job
    // has resolved with a hypo). PENDING rows are excluded from
    // BOTH numerator and denominator, mirroring the workout-outcomes
    // distribution card.
    //
    // Task #194: when the dense 0–180 min curve has landed
    // (`min_bg_180 != null`), prefer it over the per-row evaluator
    // for the hypo signal. This is a more honest hypo-risk-share —
    // it catches dips between the at-end and +1h slots that the
    // sparse evaluator would otherwise miss (and also classifies
    // sessions where at-end / +1h are still null but the curve
    // already proves no hypo occurred).
    const minWindow = numOrNull(log.min_bg_180 ?? null);
    if (minWindow != null) {
      classifiedCount++;
      if (minWindow < HYPO_THRESHOLD || log.had_hypo_window === true) {
        hypoRiskCount++;
      }
    } else {
      const outcome = evaluateExercise(log).outcome;
      if (outcome !== "PENDING") {
        classifiedCount++;
        if (outcome === "HYPO_RISK") hypoRiskCount++;
      }
    }
  }

  const medianAtEndRaw = median(deltasAtEnd);
  const median1hRaw    = median(deltas1h);

  return {
    type: target,
    count: ofType.length,
    atEndSampleSize: deltasAtEnd.length,
    oneHourSampleSize: deltas1h.length,
    medianDeltaAtEnd: medianAtEndRaw == null ? null : Math.round(medianAtEndRaw),
    medianDelta1h:    median1hRaw    == null ? null : Math.round(median1hRaw),
    classifiedCount,
    hypoRiskCount,
    hypoRiskShare: classifiedCount === 0 ? null : hypoRiskCount / classifiedCount,
  };
}

/**
 * Short, observational one-line summary of a personal pattern. Mirrors
 * the tone of `patternNote()` (neutral, never prescriptive) but speaks
 * about THIS user's data. Returns `null` when there isn't enough data
 * to make a meaningful statement (caller should hide the line).
 *
 * Threshold: at least 3 sessions of the same type with at least one
 * usable Δ measurement. Below that we don't have a personal pattern
 * worth surfacing yet.
 */
export const PATTERN_MIN_SESSIONS = 3;

/** German exercise type labels for `personalPatternHeadline`. */
function exerciseTypeLabelDE(t: ExerciseType): string {
  switch (t) {
    case "hypertrophy":
    case "strength":   return "Krafttraining";
    case "cardio":     return "Cardio";
    case "hiit":       return "HIIT";
    case "yoga":       return "Yoga";
    case "cycling":    return "Radfahren";
    case "run":        return "Laufen";
    case "football":   return "Fußball";
    case "tennis":     return "Tennis";
    case "volleyball": return "Volleyball";
    case "basketball": return "Basketball";
    case "swimming":   return "Schwimmen";
    case "breathwork": return "Atemübungen";
    case "hot_shower": return "warme Dusche";
    case "cold_shower":return "kalte Dusche";
  }
}

export function personalPatternHeadline(stats: ExerciseTypeStats, locale = "de"): string | null {
  if (stats.count < PATTERN_MIN_SESSIONS) return null;
  // Prefer the +1 h delta if we have it (captures the delayed-hypo
  // window), fall back to the at-end value otherwise.
  const delta = stats.medianDelta1h ?? stats.medianDeltaAtEnd;
  const sample = stats.medianDelta1h != null
    ? stats.oneHourSampleSize
    : stats.atEndSampleSize;
  if (delta == null || sample < PATTERN_MIN_SESSIONS) return null;
  const abs = Math.abs(delta);
  const direction = delta < 0 ? "drop" : delta > 0 ? "raise" : "hold";
  const de = locale === "de";
  if (de) {
    const typeLbl = exerciseTypeLabelDE(stats.type);
    const sign = delta >= 0 ? "+" : "−";
    if (direction === "hold" || abs < 5) {
      return `Deine ${typeLbl}-Einheiten lassen die Glukose meist unverändert (Median ${sign}${abs} mg/dL über ${sample} Einheiten).`;
    }
    const dirDE = direction === "drop" ? "senken" : "heben";
    return `Deine ${typeLbl}-Einheiten ${dirDE} die Glukose meist um ~${abs} mg/dL (Median über ${sample} Einheiten).`;
  }
  if (direction === "hold" || abs < 5) {
    return `Your ${exerciseTypeLabel(stats.type).toLowerCase()} sessions usually leave glucose roughly unchanged (median ${delta >= 0 ? "+" : "−"}${abs} mg/dL across ${sample} sessions).`;
  }
  return `Your ${exerciseTypeLabel(stats.type).toLowerCase()} sessions usually ${direction} glucose by ~${abs} mg/dL (median across ${sample} sessions).`;
}
