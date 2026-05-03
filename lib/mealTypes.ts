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
  OVERDOSE: "#FF2D78",
  UNDERDOSE: PALETTE.ORANGE,
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
  OVERDOSE: "Over Dose",
  UNDERDOSE: "Under Dose",
  HYPO_DURING: "Hypo im Verlauf",
  CHECK_CONTEXT: "Review",
};

export const EVAL_EXPLAIN: Record<string, string> = {
  GOOD: "Insulin matched carbohydrate load effectively.",
  HIGH: "Insulin exceeded glucose requirements → glucose dropped significantly.",
  OVERDOSE: "Insulin exceeded glucose requirements → glucose dropped significantly.",
  LOW: "Insulin insufficient → glucose increased after meal.",
  UNDERDOSE: "Insulin insufficient → glucose increased after meal.",
  SPIKE: "Rapid glucose increase detected post meal.",
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
