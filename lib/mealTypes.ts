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
