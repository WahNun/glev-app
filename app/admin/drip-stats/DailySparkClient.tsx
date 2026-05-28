"use client";

import { useState, useMemo } from "react";
import type { DailyBucket } from "@/lib/emails/drip-stats";

const SPARK_SENT_COLOR = "#9aa0a6";
const SPARK_UNSUB_COLOR = "#c0392b";
const SPARK_UNSUB_SELECTED_COLOR = "#8b1a12";

const DE_DAY = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;
const DE_MONTH = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
] as const;

function formatBucketDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayName = DE_DAY[date.getUTCDay()];
  const monthName = DE_MONTH[date.getUTCMonth()];
  return `${d}. ${monthName} ${y} (${dayName})`;
}

/**
 * Interactive sparkline for the drip-stats admin table.
 *
 * Replaces the static server-side DailySpark (which required hover for
 * tooltips and had no touch support). This client component:
 *
 *  • Auto-highlights the worst (highest opt-out) day on first paint so
 *    operators immediately see the spike without clicking.
 *  • Tapping/clicking a bar selects it and shows a plain-text panel
 *    below with the exact date and sent/opt-out counts — works on touch
 *    devices, screen readers, and keyboard navigation.
 *  • Clicking the same bar again deselects it (clears the panel).
 *
 * The SVG layout and colors match the original server-only DailySpark
 * so the table column width doesn't change.
 */
export function DailySparkClient({
  buckets,
  label,
  width = 150,
  height = 32,
}: {
  buckets: ReadonlyArray<DailyBucket>;
  label: string;
  width?: number;
  height?: number;
}) {
  const n = buckets.length;

  const defaultIdx = useMemo<number | null>(() => {
    let maxUnsub = 0;
    let best: number | null = null;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].unsubscribed > maxUnsub) {
        maxUnsub = buckets[i].unsubscribed;
        best = i;
      }
    }
    return best;
  }, [buckets]);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(defaultIdx);

  if (n === 0) {
    return <span style={{ color: "#999", fontSize: 13 }}>—</span>;
  }

  let max = 0;
  for (const b of buckets) {
    if (b.sent > max) max = b.sent;
    if (b.unsubscribed > max) max = b.unsubscribed;
  }
  if (max === 0) max = 1;

  const padTop = 2;
  const padBottom = 2;
  const innerH = Math.max(1, height - padTop - padBottom);
  const slot = width / n;
  const barW = Math.max(1, (slot - 1) / 2);
  const baseY = height - padBottom;

  const selectedBucket = selectedIdx !== null ? buckets[selectedIdx] : null;

  function handleClick(i: number) {
    setSelectedIdx((prev) => (prev === i ? null : i));
  }

  return (
    <div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}: Balken antippen für Details`}
        style={{
          display: "block",
          background: "#fafafa",
          borderRadius: 3,
          cursor: "pointer",
        }}
      >
        {buckets.map((b, i) => {
          const x = i * slot;
          const sentH = (b.sent / max) * innerH;
          const unsubH = (b.unsubscribed / max) * innerH;
          const isSelected = i === selectedIdx;

          return (
            <g
              key={b.day}
              onClick={() => handleClick(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleClick(i);
              }}
              role="button"
              tabIndex={0}
              aria-label={`${b.day}: ${b.sent} versendet, ${b.unsubscribed} abgemeldet`}
              aria-pressed={isSelected}
              style={{ outline: "none" }}
            >
              {isSelected && (
                <rect
                  x={x}
                  y={0}
                  width={slot}
                  height={height}
                  fill="rgba(192, 57, 43, 0.13)"
                  rx={1}
                />
              )}
              {b.sent > 0 && (
                <rect
                  x={x}
                  y={baseY - sentH}
                  width={barW}
                  height={sentH}
                  fill={SPARK_SENT_COLOR}
                />
              )}
              {b.unsubscribed > 0 && (
                <rect
                  x={x + barW + 1}
                  y={baseY - unsubH}
                  width={barW}
                  height={Math.max(1, unsubH)}
                  fill={isSelected ? SPARK_UNSUB_SELECTED_COLOR : SPARK_UNSUB_COLOR}
                />
              )}
              {/* Invisible full-height hit area — makes tapping easy on touch */}
              <rect
                x={x}
                y={0}
                width={slot}
                height={height}
                fill="transparent"
              />
            </g>
          );
        })}
      </svg>

      {selectedBucket !== null ? (
        <div style={panelStyle}>
          <span style={{ fontWeight: 600, color: "#111" }}>
            {formatBucketDay(selectedBucket.day)}
          </span>
          <br />
          <span style={{ color: "#555" }}>
            {selectedBucket.sent.toLocaleString("de-DE")} Versendet
            {" · "}
            <span
              style={{
                color:
                  selectedBucket.unsubscribed > 0 ? SPARK_UNSUB_COLOR : "#555",
                fontWeight: selectedBucket.unsubscribed > 0 ? 600 : 400,
              }}
            >
              {selectedBucket.unsubscribed.toLocaleString("de-DE")} Abgemeldet
            </span>
          </span>
        </div>
      ) : (
        <div style={hintStyle}>Balken antippen für Details</div>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  marginTop: 6,
  padding: "5px 9px",
  background: "#fff8f8",
  border: "1px solid #f0d0d0",
  borderRadius: 5,
  fontSize: 12,
  lineHeight: 1.5,
  color: "#333",
  whiteSpace: "nowrap",
};

const hintStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  color: "#bbb",
  fontStyle: "italic",
};
