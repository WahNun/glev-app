import type { NutritionSource } from "./types";

export type BadgeKind = "verified" | "mixed" | "estimated";

/**
 * Aggregate badge for a list of nutrition items.
 *
 * - all non-estimated  → "verified"  (✅  — at least one DB hit, none estimated)
 * - mix of both        → "mixed"     (✨  accented)
 * - all estimated      → "estimated" (✨)
 * - empty list         → "estimated" (safe default)
 *
 * "unknown" sources are treated as estimated (they never resolved).
 */
export function aggregateBadge(
  items: ReadonlyArray<{ source: NutritionSource }>,
): BadgeKind {
  if (items.length === 0) return "estimated";

  const dbSources: NutritionSource[] = [
    "open_food_facts",
    "usda",
    "user_history",
    "user_confirmed",
  ];

  const anyVerified = items.some((i) => dbSources.includes(i.source));
  const anyEstimated = items.some(
    (i) => i.source === "estimated" || i.source === "unknown",
  );

  if (anyVerified && anyEstimated) return "mixed";
  if (anyVerified) return "verified";
  return "estimated";
}

/** Human-readable label for a single NutritionSource. */
export function sourceLabel(source: NutritionSource, locale: "de" | "en" = "de"): string {
  if (locale === "en") {
    switch (source) {
      case "open_food_facts": return "OFF";
      case "usda":            return "USDA";
      case "user_history":
      case "user_confirmed":  return "Logs";
      default:                return "AI";
    }
  }
  switch (source) {
    case "open_food_facts": return "OFF";
    case "usda":            return "USDA";
    case "user_history":
    case "user_confirmed":  return "Logs";
    default:                return "KI";
  }
}
