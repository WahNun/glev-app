/* Trend arrow icon — three flavours (NE up, SE down, →flat) matching
   the hero mockup's stroke style. Color is passed in so it tracks the
   current value's range color (GREEN / ORANGE / PINK).

   Extracted from CurrentDayGlucoseCard so the same SVG can be reused on
   the meal expanded view (Task #265) without duplicating markup. The
   prop shape and SVG output are intentionally identical to the previous
   inline component so the live widget remains byte-for-byte unchanged. */

export default function TrendArrowIcon({
  direction,
  color,
}: {
  direction: "up" | "down" | "flat";
  color: string;
}) {
  const common = {
    width: 14, height: 14, viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth: 2.5,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  if (direction === "up") {
    return (
      <svg {...common}>
        <line x1="7" y1="17" x2="17" y2="7" />
        <polyline points="9 7 17 7 17 15" />
      </svg>
    );
  }
  if (direction === "down") {
    return (
      <svg {...common}>
        <line x1="7" y1="7" x2="17" y2="17" />
        <polyline points="9 17 17 17 17 9" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="15 8 19 12 15 16" />
    </svg>
  );
}
