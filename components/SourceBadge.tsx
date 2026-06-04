"use client";

import { useLocale } from "next-intl";
import { sourceLabel } from "@/lib/nutrition/badgeFor";
import type { NutritionSource } from "@/lib/nutrition/types";

/**
 * SourceBadge — compact provenance pill for a single nutrition item.
 *
 * Verified DB sources (OFF / USDA / Logs) render a ✅ check; AI
 * estimates render a ✨ sparkle.  Size is kept tight so it slots inline
 * next to food-item names in the chat chip item list.
 */
export default function SourceBadge({
  source,
  locale: localeProp,
}: {
  source: NutritionSource;
  /** Override locale (useful in non-client contexts that already resolved locale). */
  locale?: "de" | "en";
}) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const resolvedLocale = localeProp ?? (useLocale() === "en" ? "en" : "de");

  const isVerified =
    source === "open_food_facts" ||
    source === "usda" ||
    source === "user_history" ||
    source === "user_confirmed";

  const icon  = isVerified ? "✅" : "✨";
  const label = sourceLabel(source, resolvedLocale);

  return (
    <span
      style={{
        display:        "inline-flex",
        alignItems:     "center",
        gap:            3,
        fontSize:       10,
        fontWeight:     600,
        letterSpacing:  "0.04em",
        padding:        "1px 5px",
        borderRadius:   6,
        background:     isVerified ? "rgba(34,211,160,0.1)" : "rgba(139,92,246,0.12)",
        color:          isVerified ? "#22D3A0"               : "#a78bfa",
        whiteSpace:     "nowrap",
        flexShrink:     0,
      }}
      title={source}
    >
      {icon} {label}
    </span>
  );
}
