export const PALETTE = {
  ORANGE: "#FF9500",
  GREEN:  "#22D3A0",
  BLUE:   "#3B82F6",
  PURPLE: "#A855F7",
} as const;

// Task #15: HIGH_FIBER bucket retired — `classifyMeal` now returns
// FAST_CARBS / HIGH_PROTEIN / HIGH_FAT / BALANCED only. The legacy
// HIGH_FIBER colour is kept in the COLORS map below as a defensive
// fallback so any historical row still rendering with that label
// keeps its original tint instead of defaulting to grey.
export type MealType = "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED";

export const TYPE_COLORS: Record<string, string> = {
  FAST_CARBS:   PALETTE.ORANGE,
  HIGH_PROTEIN: PALETTE.BLUE,
  HIGH_FAT:     PALETTE.PURPLE,
  HIGH_FIBER:   "#4DB6AC", // legacy — pre-Task#15 rows
  BALANCED:     PALETTE.GREEN,
};

export const TYPE_LABELS: Record<string, string> = {
  FAST_CARBS:   "Fast Carbs",
  HIGH_PROTEIN: "High Protein",
  HIGH_FAT:     "High Fat",
  BALANCED:     "Balanced",
};

export const TYPE_SHORT: Record<string, string> = {
  FAST_CARBS:   "FC",
  HIGH_PROTEIN: "HP",
  HIGH_FAT:     "HF",
  BALANCED:     "B",
};

export const TYPE_EXPLAIN: Record<string, string> = {
  FAST_CARBS:   "High glycemic load, low fiber → fast absorption",
  HIGH_PROTEIN: "High protein ratio slows glucose absorption",
  HIGH_FAT:     "High fat delays the glucose spike",
  BALANCED:     "Even macro distribution → stable glucose response",
};

export function getTypeColor(t?: string | null) {
  return t ? TYPE_COLORS[t] || "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.5)";
}
export function getTypeLabel(t?: string | null) {
  if (!t) return "—";
  return TYPE_LABELS[t] || t.replace("_"," ").toLowerCase();
}
export function getTypeShort(t?: string | null) {
  if (!t) return "—";
  return TYPE_SHORT[t] || t.slice(0,2).toUpperCase();
}
export function getTypeExplain(t?: string | null) {
  return t ? TYPE_EXPLAIN[t] || "" : "";
}

export const EVAL_COLORS: Record<string, string> = {
  GOOD: PALETTE.GREEN,
  LOW: PALETTE.ORANGE,
  HIGH: "#FF2D78",
  SPIKE: "#FFD60A",
  // Task #251: SPIKE_STRONG = severe rapid spike (peak/Δ above 1.5×
  // class-cutoff OR speed ≥ 2.5 mg/dL/min). Deeper amber so it reads
  // visibly more alarming than the regular yellow SPIKE chip.
  SPIKE_STRONG: "#FF6A00",
  OVERDOSE: "#FF2D78",
  UNDERDOSE: PALETTE.ORANGE,
  // Three-tier intermediate outcomes — amber for advisory, not alarming.
  SLIGHTLY_OVER:  "#F59E0B",
  SLIGHTLY_UNDER: "#F59E0B",
  // Task #187: hypos detected anywhere inside the 3h post-meal window
  // share the same magenta as OVERDOSE — both are "post-meal low" from
  // the user's perspective and we want them to read identically on the
  // entries chip / dashboard / insights.
  HYPO_DURING: "#FF2D78",
  CHECK_CONTEXT: PALETTE.ORANGE,
};

export const EVAL_LABELS: Record<string, string> = {
  GOOD: "Good",
  LOW: "Under Dose",
  HIGH: "Over Dose",
  SPIKE: "Spike",
  SPIKE_STRONG: "Strong Spike",
  OVERDOSE: "Over Dose",
  UNDERDOSE: "Under Dose",
  SLIGHTLY_OVER:  "Slightly High",
  SLIGHTLY_UNDER: "Slightly Low",
  HYPO_DURING: "Hypo im Verlauf",
  CHECK_CONTEXT: "Review",
};

export const EVAL_EXPLAIN: Record<string, string> = {
  GOOD: "Insulin matched carbohydrate load effectively.",
  HIGH: "Insulin exceeded glucose requirements → glucose dropped significantly.",
  OVERDOSE: "Insulin exceeded glucose requirements → glucose dropped significantly.",
  SLIGHTLY_OVER:  "Dose slightly above ICR expectation — monitor for mild low.",
  SLIGHTLY_UNDER: "Dose slightly below ICR expectation — monitor for mild high.",
  LOW: "Insulin insufficient → glucose increased after meal.",
  UNDERDOSE: "Insulin insufficient → glucose increased after meal.",
  SPIKE: "Rapid glucose increase detected post meal.",
  SPIKE_STRONG: "Severe rapid glucose spike — magnitude or rate well above the per-meal threshold.",
  HYPO_DURING: "Glucose dropped below 70 mg/dL somewhere inside the 3h post-meal window — even if the 2h reading was back in range.",
  CHECK_CONTEXT: "Outcome unclear — review context before adjusting.",
};

export function getEvalColor(ev?: string | null) {
  return ev ? EVAL_COLORS[ev] || "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.3)";
}
export function getEvalLabel(ev?: string | null) {
  if (!ev) return "—";
  return EVAL_LABELS[ev] || ev;
}
export function getEvalExplain(ev?: string | null) {
  return ev ? EVAL_EXPLAIN[ev] || "" : "";
}

/**
 * i18n-aware chip-label helpers (Task #279).
 *
 * The legacy `get*Label` / `get*Explain` functions above keep returning
 * hardcoded English so non-React call sites (engine, lifecycle, tests)
 * still get a sensible string. UI surfaces should prefer
 * {@link useChipLabels} (React hook) or {@link chipLabelsFrom} (callable
 * with a next-intl `t` handle) so chips render in the active locale.
 *
 * Translator handle compatible with `useTranslations("chips")`.
 */
type ChipsTranslator = (key: string, values?: Record<string, string | number>) => string;

/** Bundle of chip-label functions wired to the active translator. */
export type ChipLabels = {
  evalLabel:   (ev?: string | null) => string;
  evalExplain: (ev?: string | null) => string;
  typeLabel:   (t?: string | null) => string;
  typeExplain: (t?: string | null) => string;
};

/**
 * Build a {@link ChipLabels} bundle from any next-intl translator
 * scoped to the `chips` namespace. Each function falls back to the
 * hardcoded English label when the key is missing — defensive against
 * future label additions that haven't been mirrored into the message
 * catalogues yet.
 */
export function chipLabelsFrom(t: ChipsTranslator): ChipLabels {
  // next-intl throws on missing keys; the safe wrapper swallows the
  // throw and returns the supplied fallback so a stale catalogue can
  // never crash a chip render.
  const safe = (key: string, fallback: string): string => {
    try {
      const v = t(key);
      return v && v !== key ? v : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    evalLabel: (ev) => {
      if (!ev) return "—";
      return safe(`eval_${ev}`, EVAL_LABELS[ev] || ev);
    },
    evalExplain: (ev) => {
      if (!ev) return "";
      return safe(`eval_explain_${ev}`, EVAL_EXPLAIN[ev] || "");
    },
    typeLabel: (ty) => {
      if (!ty) return "—";
      return safe(`type_${ty}`, TYPE_LABELS[ty] || ty.replace("_", " ").toLowerCase());
    },
    typeExplain: (ty) => {
      if (!ty) return "";
      return safe(`type_explain_${ty}`, TYPE_EXPLAIN[ty] || "");
    },
  };
}
