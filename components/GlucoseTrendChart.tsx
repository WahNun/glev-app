"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Meal } from "@/lib/meals";
import { useCrosshair, CrosshairOverlay, CrosshairTooltip, type CrosshairPoint } from "@/components/ChartCrosshair";
import { parseDbDate } from "@/lib/time";

const ACCENT = "#4F6EF7";
const GREEN = "#22D3A0";
const PINK = "#FF2D78";
const ORANGE = "#FF9500";
const SURFACE = "var(--surface)";

/**
 * Self-contained "Glucose Trend" content (header + chart + crosshair).
 * Caller provides the surrounding card chrome (background, border, padding,
 * flip behavior etc.). Used by both the dashboard and the insights page so
 * the visuals stay in sync.
 */
export default function GlucoseTrendFront({
  meals,
  showFlipHint = true,
}: {
  meals: Meal[];
  showFlipHint?: boolean;
}) {
  const DAYS = 14;
  const now = Date.now();

  const buckets: Record<string, number[]> = {};
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(now - (DAYS - 1 - i) * 86400000);
    buckets[d.toDateString()] = [];
  }
  meals.forEach((m) => {
    const d = parseDbDate(m.created_at).toDateString();
    if (d in buckets && m.glucose_before) buckets[d].push(m.glucose_before);
  });
  const dateLabels = Object.keys(buckets);
  const points = Object.values(buckets).map((arr) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
  );
  const filled: number[] = [];
  let last = 110;
  points.forEach((v) => {
    if (v !== null) last = v;
    filled.push(last);
  });

  type Pt = { i: number; v: number };
  const realPts: Pt[] = [];
  points.forEach((v, i) => {
    if (v != null) realPts.push({ i, v });
  });
  const hiPt: Pt | null = realPts.length ? realPts.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const loPt: Pt | null = realPts.length ? realPts.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  const last7 = realPts.slice(-7);
  const recentAvg = last7.length ? Math.round(last7.reduce((s, p) => s + p.v, 0) / last7.length) : null;

  // Measured-pixel-space SVG so the chart fills any container without
  // aspect-ratio distortion (and so the crosshair uses real coords).
  const chartRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 720, h: 280 });
  useEffect(() => {
    const el = chartRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      if (r.width > 0 && r.height > 0) {
        setSize({ w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = size.w;
  const H = size.h;
  const padL = 32, padR = 14, padT = 16, padB = 30;
  const mn = 60, mx = 240;
  const toY = (v: number) => padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB);
  const toX = (i: number) => padL + (i / Math.max(1, DAYS - 1)) * (W - padL - padR);

  const path = filled.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const area =
    path +
    ` L${toX(DAYS - 1).toFixed(1)},${(H - padB).toFixed(1)} L${toX(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;

  const crosshairPoints = useMemo<CrosshairPoint[]>(() => {
    if (W <= 0 || H <= 0) return [];
    const out: CrosshairPoint[] = [];
    points.forEach((v, i) => {
      if (v == null) return;
      const date = new Date(dateLabels[i]);
      out.push({
        x: toX(i),
        y: toY(v),
        color: ACCENT,
        tooltip: [
          date.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" }),
          `${Math.round(v)} mg/dL avg`,
        ],
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, dateLabels, W, H]);

  const { active, handlers } = useCrosshair(crosshairPoints);

  const recentColor = recentAvg
    ? recentAvg > 140
      ? ORANGE
      : recentAvg < 80
      ? PINK
      : GREEN
    : "var(--text-dim)";

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Glucose Trend</div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>
            Avg pre-meal glucose · last 14 days
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          {recentAvg && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: "var(--text-faint)", letterSpacing: "0.08em", fontWeight: 600 }}>
                7-DAY AVG
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  color: recentColor,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                {recentAvg}
              </div>
            </div>
          )}
          {showFlipHint && (
            <span style={{ fontSize: 9, color: "var(--text-ghost)", marginLeft: 4 }}>↺</span>
          )}
        </div>
      </div>

      {/* Chart */}
      <div
        ref={chartRef}
        onClick={(e) => {
          // Don't flip the parent card while interacting with the crosshair.
          e.stopPropagation();
        }}
        style={{ flex: 1, minHeight: 0, position: "relative", touchAction: "pan-y" }}
        {...handlers}
      >
        {W > 0 && H > 0 && (
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            style={{ display: "block", position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
          >
            {/* In-range band */}
            <rect
              x={padL}
              y={toY(180)}
              width={W - padL - padR}
              height={toY(80) - toY(180)}
              fill={GREEN}
              fillOpacity="0.05"
            />
            {[80, 110, 140, 180, 220].map((v) => (
              <g key={v}>
                <line
                  x1={padL}
                  y1={toY(v)}
                  x2={W - padR}
                  y2={toY(v)}
                  stroke="var(--surface-soft)"
                  strokeDasharray="3 4"
                />
                <text x={padL - 5} y={toY(v) + 4} textAnchor="end" fontSize="10" fill="var(--text-ghost)">
                  {v}
                </text>
              </g>
            ))}
            <defs>
              <linearGradient id="glevTrendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCENT} stopOpacity="0.28" />
                <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#glevTrendGrad)" />
            <path
              d={path}
              fill="none"
              stroke={ACCENT}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {filled.map((v, i) =>
              points[i] !== null ? (
                <circle key={i} cx={toX(i)} cy={toY(v)} r="3" fill={ACCENT} stroke={SURFACE} strokeWidth="1.5" />
              ) : null
            )}
            {hiPt && (
              <g>
                <circle cx={toX(hiPt.i)} cy={toY(hiPt.v)} r="5" fill="none" stroke={ORANGE} strokeWidth="1.5" />
                <text
                  x={toX(hiPt.i)}
                  y={toY(hiPt.v) - 9}
                  textAnchor="middle"
                  fontSize="10"
                  fill={ORANGE}
                  fontWeight="700"
                >
                  ↑ {Math.round(hiPt.v)}
                </text>
              </g>
            )}
            {loPt && (
              <g>
                <circle cx={toX(loPt.i)} cy={toY(loPt.v)} r="5" fill="none" stroke={PINK} strokeWidth="1.5" />
                <text
                  x={toX(loPt.i)}
                  y={toY(loPt.v) + 16}
                  textAnchor="middle"
                  fontSize="10"
                  fill={PINK}
                  fontWeight="700"
                >
                  ↓ {Math.round(loPt.v)}
                </text>
              </g>
            )}
            {/* X labels: every other day */}
            {dateLabels.map((d, i) =>
              i % 2 === 0 || i === DAYS - 1 ? (
                <text
                  key={i}
                  x={toX(i)}
                  y={H - 10}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text-ghost)"
                >
                  {new Date(d).toLocaleDateString("en", { month: "short", day: "numeric" })}
                </text>
              ) : null
            )}
            <CrosshairOverlay active={active} top={padT} bottom={H - padB} left={padL} right={W - padR} />
          </svg>
        )}
        <CrosshairTooltip active={active} containerWidth={W} containerHeight={H} />
      </div>
    </>
  );
}
