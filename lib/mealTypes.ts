export const PALETTE = {
  ORANGE: "#FF9500",
  GREEN:  "#22D3A0",
  BLUE:   "#3B82F6",
  PURPLE: "#A855F7",
} as const;

export type MealType = "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED";

export const TYPE_COLORS: Record<string, string> = {
  FAST_CARBS:   PALETTE.ORANGE,
  HIGH_PROTEIN: PALETTE.BLUE,
  HIGH_FAT:     PALETTE.PURPLE,
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
  CHECK_CONTEXT: PALETTE.ORANGE,
};

export const EVAL_LABELS: Record<string, string> = {
  GOOD: "Good",
  LOW: "Under Dose",
  HIGH: "Over Dose",
  SPIKE: "Spike",
  OVERDOSE: "Over Dose",
  UNDERDOSE: "Under Dose",
  CHECK_CONTEXT: "Review",
};

export const EVAL_EXPLAIN: Record<string, string> = {
  GOOD: "Insulin matched carbohydrate load effectively.",
  HIGH: "Insulin exceeded glucose requirements → glucose dropped significantly.",
  OVERDOSE: "Insulin exceeded glucose requirements → glucose dropped significantly.",
  LOW: "Insulin insufficient → glucose increased after meal.",
  UNDERDOSE: "Insulin insufficient → glucose increased after meal.",
  SPIKE: "Rapid glucose increase detected post meal.",
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
