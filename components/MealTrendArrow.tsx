"use client";

import { useTranslations } from "next-intl";

const ORANGE = "#FF9500";
const PINK   = "#FF2D78";
const ACCENT = "#4F6EF7";

const TREND_META: Record<string, { glyph: string; color: string }> = {
  rising_fast:  { glyph: "↑", color: ORANGE },
  rising:       { glyph: "↗", color: ACCENT },
  stable:       { glyph: "→", color: "var(--text-dim)" },
  falling:      { glyph: "↘", color: ACCENT },
  falling_fast: { glyph: "↓", color: PINK },
};

/**
 * Renders a pre-meal trend arrow glyph for a saved meal entry.
 * Uses the `engine_eval_trend_*` strings (post-hoc wording) as the tooltip.
 * Returns null when trend is null/undefined or unrecognised.
 */
export default function MealTrendArrow({
  trend,
  size = "md",
}: {
  trend: string | null | undefined;
  size?: "sm" | "md";
}) {
  const tEngine = useTranslations("engine");
  if (!trend || !TREND_META[trend]) return null;
  const { glyph, color } = TREND_META[trend];
  const tooltip = tEngine(`engine_eval_trend_${trend}` as never);
  const isSm = size === "sm";
  return (
    <span
      role="img"
      aria-label={tooltip}
      title={tooltip}
      data-testid={`meal-trend-arrow-${trend}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: isSm ? 15 : 18,
        height: isSm ? 15 : 18,
        borderRadius: 4,
        padding: "0 3px",
        fontSize: isSm ? 11 : 13,
        lineHeight: 1,
        fontWeight: 800,
        color,
        background:
          color === "var(--text-dim)"
            ? "var(--surface-2, rgba(255,255,255,0.06))"
            : `${color}1f`,
        flexShrink: 0,
      }}
    >
      {glyph}
    </span>
  );
}
